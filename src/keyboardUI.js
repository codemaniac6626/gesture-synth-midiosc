/**
 * @file keyboardUI.js
 * @description Renders an interactive, collapsible 3-octave virtual piano keyboard (C3 to C6 / MIDI 48-84)
 * as a footer strip. Highlights active MIDI notes in real time and dims/disables the component when MIDI output is disabled.
 */

import { midiNoteToName } from "./musicTheory.js";

/** START MIDI Note (C3) */
const START_MIDI_NOTE = 48;

/** END MIDI Note (C6) */
const END_MIDI_NOTE = 84;

/** Map of MIDI note number to DOM element */
const keyElementsMap = new Map();

/** Current collapse state */
let isCollapsed = false;

/**
 * Generates the piano key elements (white & black) for C3 to C6 and appends them to the wrapper container.
 *
 * @param {HTMLElement} wrapper DOM container for the keys.
 * @param {MidiEngine} midi Web MIDI engine instance for interactive playback.
 */
function buildKeyboardKeys(wrapper, midi) {
  wrapper.innerHTML = "";
  keyElementsMap.clear();

  let whiteKeyCount = 0;

  for (let note = START_MIDI_NOTE; note <= END_MIDI_NOTE; note++) {
    const isBlack = [1, 3, 6, 8, 10].includes(note % 12);
    const keyEl = document.createElement("div");
    const noteName = midiNoteToName(note);

    if (!isBlack) {
      keyEl.className = "key-white";
      keyEl.dataset.note = note;

      // Add label on C notes (C3, C4, C5, C6)
      if (note % 12 === 0) {
        const label = document.createElement("span");
        label.className = "key-label";
        label.textContent = noteName;
        keyEl.appendChild(label);
      }

      wrapper.appendChild(keyEl);
      keyElementsMap.set(note, keyEl);
      whiteKeyCount++;
    } else {
      keyEl.className = "key-black";
      keyEl.dataset.note = note;

      // Position black key between the preceding white key and current white key
      // Each white key is 24px wide. Center black key (14px) at border -> left = (whiteKeyCount * 24 - 7)px
      const leftPx = whiteKeyCount * 24 - 7;
      keyEl.style.left = `${leftPx}px`;

      wrapper.appendChild(keyEl);
      keyElementsMap.set(note, keyEl);
    }

    // Interactive mouse / touch trigger on keys if MIDI is enabled
    keyEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (midi && midi.isEnabled) {
        midi.sendNoteOn(note, 100);
      }
    });

    keyEl.addEventListener("mouseup", (e) => {
      e.stopPropagation();
      if (midi && midi.isEnabled) {
        midi.sendNoteOff(note);
      }
    });

    keyEl.addEventListener("mouseleave", () => {
      if (midi && midi.isEnabled && keyEl.classList.contains("active")) {
        midi.sendNoteOff(note);
      }
    });
  }

  // Set explicit width on wrapper based on white keys count
  wrapper.style.width = `${whiteKeyCount * 24}px`;
}

/**
 * Updates the highlight state of all piano keys based on currently active MIDI notes.
 *
 * @param {Set<number>|Array<number>} activeNotes Active MIDI note numbers.
 * @param {boolean} isMidiEnabled Whether MIDI output is currently enabled in app settings.
 */
export function updateKeyboardHighlight(activeNotes, isMidiEnabled = true) {
  const activeSet = activeNotes instanceof Set ? activeNotes : new Set(activeNotes || []);

  keyElementsMap.forEach((el, note) => {
    if (isMidiEnabled && activeSet.has(note)) {
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  });
}

/**
 * Updates the visual enabled/disabled state of the keyboard strip.
 * When MIDI is disabled, shows a translucent overlay banner and dims out the keys.
 *
 * @param {boolean} isMidiEnabled True if MIDI output is enabled in app settings.
 */
export function updateKeyboardMidiState(isMidiEnabled) {
  const footerEl = document.getElementById("keyboardFooter");
  const overlayEl = document.getElementById("keyboardDisabledOverlay");
  const statusTextEl = document.getElementById("keyboardStatusText");

  if (!footerEl || !overlayEl || !statusTextEl) return;

  if (isMidiEnabled) {
    footerEl.classList.remove("midi-disabled");
    overlayEl.style.display = "none";
    statusTextEl.textContent = "C3 - C6 (Active Output)";
  } else {
    footerEl.classList.add("midi-disabled");
    overlayEl.style.display = "flex";
    statusTextEl.textContent = "MIDI Output Disabled";
    // Clear any active key highlights
    updateKeyboardHighlight([], false);
  }
}

/**
 * Initializes the collapsible keyboard UI strip, builds the keys, and binds toggle listeners.
 *
 * @param {MidiEngine} midi Web MIDI Engine instance.
 * @param {Object} currentConfig App preset configuration.
 */
export function initKeyboardUI(midi, currentConfig) {
  const footerEl = document.getElementById("keyboardFooter");
  const headerEl = document.getElementById("keyboardHeader");
  const toggleBtnEl = document.getElementById("keyboardToggleBtn");
  const toggleIconEl = document.getElementById("keyboardToggleIcon");
  const wrapperEl = document.getElementById("keyboardKeysWrapper");

  if (!footerEl || !wrapperEl) return;

  // Build 3-octave piano keys
  buildKeyboardKeys(wrapperEl, midi);

  // Bind collapse / expand toggle handler
  const toggleCollapse = (e) => {
    e.stopPropagation();
    isCollapsed = !isCollapsed;
    footerEl.classList.toggle("collapsed", isCollapsed);
    if (toggleIconEl) {
      toggleIconEl.textContent = isCollapsed ? "▲" : "▼";
    }
  };

  headerEl?.addEventListener("click", toggleCollapse);
  toggleBtnEl?.addEventListener("click", toggleCollapse);

  // Subscribe to MIDI Engine callbacks for real-time key lighting & status sync
  if (midi) {
    midi.onActivity(() => {
      if (midi.isEnabled) {
        updateKeyboardHighlight(midi.activeNotes, true);
      }
    });

    midi.onStateChange((status) => {
      updateKeyboardMidiState(status.isEnabled);
    });

    // Initial sync
    updateKeyboardMidiState(currentConfig?.midiEnabled ?? midi.isEnabled);
  }
}
