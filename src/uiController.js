/**
 * @file uiController.js
 * @description Controls DOM interface elements, settings modal forms, tab switching,
 * preset JSON export/import, Web MIDI device status badges, and volume LED meter bars.
 */

import { 
  getPresetState, 
  setPresetState, 
  getCurrentConfig, 
  setCurrentConfig, 
  loadPresetState, 
  savePresetState 
} from "./config.js";
import { midiNoteToName } from "./musicTheory.js";
import { updateKeyboardMidiState } from "./keyboardUI.js";
import defaultPresetData from "../presets.json";

/** Track whether settings event listeners have been bound to prevent duplicate bindings */
let isEventsBound = false;

/**
 * Updates the vertical volume bar LED indicators based on current volume.
 *
 * @param {number} volume01 Volume factor from 0.0 to 1.0.
 * @param {Array<HTMLElement>} volumeBarEls Array of volume bar DOM elements.
 */
export function updateVolumeMeter(volume01, volumeBarEls) {
  const litCount = Math.round(volume01 * volumeBarEls.length);
  volumeBarEls.forEach((bar) => {
    const index = Number(bar.dataset.index);
    bar.classList.toggle("lit", index >= volumeBarEls.length - litCount);
  });
}

/**
 * Applies active preset MIDI configuration to the Web MIDI engine instance.
 *
 * @param {MidiEngine} midi MidiEngine instance.
 */
export function applyConfigToEngines(midi) {
  const currentConfig = getCurrentConfig();
  midi.setEnabled(currentConfig.midiEnabled);
  midi.setChannel(currentConfig.midiChannel || 1);
  midi.setOutput(currentConfig.selectedMidiOutput || "all");
  updateKeyboardMidiState(currentConfig.midiEnabled);
}

/**
 * Populates form fields inside the Settings modal to reflect active preset state.
 *
 * @param {MidiEngine} midi Web MIDI engine instance.
 * @param {SynthEngine} synth Web Audio synth instance.
 */
export function setupSettingsUI(midi, synth) {
  const presetState = getPresetState();
  const currentConfig = getCurrentConfig();

  // Populate MIDI Channels (1-16)
  const channelSelect = document.getElementById("cfgMidiChannelSelect");
  if (channelSelect) {
    channelSelect.innerHTML = Array.from({ length: 16 }, (_, i) => i + 1)
      .map(c => `<option value="${c}">${c}</option>`).join("");
  }

  // Sync general controls with currentConfig
  const midiEnabledEl = document.getElementById("cfgMidiEnabled");
  if (midiEnabledEl) midiEnabledEl.checked = currentConfig.midiEnabled;

  const audioEnabledEl = document.getElementById("cfgAudioEnabled");
  if (audioEnabledEl) audioEnabledEl.checked = currentConfig.audioEnabled;

  if (channelSelect) channelSelect.value = currentConfig.midiChannel || 1;

  const masterVolEl = document.getElementById("cfgMasterVolume");
  if (masterVolEl) masterVolEl.value = currentConfig.masterVolume ?? 0.8;

  const sendChordsEl = document.getElementById("cfgLeftSendChords");
  if (sendChordsEl) sendChordsEl.checked = currentConfig.leftHand?.sendChords ?? true;

  const transposeEl = document.getElementById("cfgLeftTranspose");
  if (transposeEl) transposeEl.value = currentConfig.leftHand?.transpose ?? 0;

  // Left hand tilt CC
  const leftTiltEnabledEl = document.getElementById("cfgLeftTiltEnabled");
  if (leftTiltEnabledEl) leftTiltEnabledEl.checked = currentConfig.leftHand?.tilt?.enabled ?? true;

  const leftTiltCCEl = document.getElementById("cfgLeftTiltCC");
  if (leftTiltCCEl) leftTiltCCEl.value = currentConfig.leftHand?.tilt?.ccNumber ?? 14;

  // Right hand tilt CC, mode & minVal/maxVal
  const rightTiltEnabledEl = document.getElementById("cfgRightTiltEnabled");
  if (rightTiltEnabledEl) rightTiltEnabledEl.checked = currentConfig.rightHand?.tilt?.enabled ?? true;

  const rightTiltModeEl = document.getElementById("cfgRightTiltMode");
  if (rightTiltModeEl) rightTiltModeEl.value = currentConfig.rightHand?.tilt?.mode || "normal";

  const rightTiltInvertEl = document.getElementById("cfgRightTiltInvert");
  if (rightTiltInvertEl) rightTiltInvertEl.checked = currentConfig.rightHand?.tilt?.invert ?? false;

  const rightTiltCCEl = document.getElementById("cfgRightTiltCC");
  if (rightTiltCCEl) rightTiltCCEl.value = currentConfig.rightHand?.tilt?.ccNumber ?? 1;

  const rightTiltMinValEl = document.getElementById("cfgRightTiltMinVal");
  if (rightTiltMinValEl) rightTiltMinValEl.value = currentConfig.rightHand?.tilt?.minVal ?? 0;

  const rightTiltMaxValEl = document.getElementById("cfgRightTiltMaxVal");
  if (rightTiltMaxValEl) rightTiltMaxValEl.value = currentConfig.rightHand?.tilt?.maxVal ?? 127;

  // Right hand height CC & minVal/maxVal
  const rightHeightEnabledEl = document.getElementById("cfgRightHeightEnabled");
  if (rightHeightEnabledEl) rightHeightEnabledEl.checked = currentConfig.rightHand?.height?.enabled ?? true;

  const rightHeightCCEl = document.getElementById("cfgRightHeightCC");
  if (rightHeightCCEl) rightHeightCCEl.value = currentConfig.rightHand?.height?.ccNumber ?? 7;

  const rightHeightMinValEl = document.getElementById("cfgRightHeightMinVal");
  if (rightHeightMinValEl) rightHeightMinValEl.value = currentConfig.rightHand?.height?.minVal ?? 0;

  const rightHeightMaxValEl = document.getElementById("cfgRightHeightMaxVal");
  if (rightHeightMaxValEl) rightHeightMaxValEl.value = currentConfig.rightHand?.height?.maxVal ?? 127;

  // Render Preset dropdown
  const presetSelect = document.getElementById("cfgPresetSelect");
  const applyPresetRow = document.getElementById("applyPresetRow");
  if (presetSelect) {
    const activeId = currentConfig.id;
    const currentVal = presetSelect.value || activeId;
    const selectedId = presetState.presets.some(p => p.id === currentVal) ? currentVal : activeId;

    presetSelect.innerHTML = presetState.presets
      .map(p => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${p.name}${p.id === activeId ? " (Active)" : ""}</option>`)
      .join("");

    if (applyPresetRow) {
      applyPresetRow.style.display = (selectedId !== activeId) ? "flex" : "none";
    }
  }

  // Render Left Hand Gestures UI Cards
  const leftContainer = document.getElementById("leftGestureContainer");
  if (leftContainer) {
    const leftGestures = currentConfig.leftHand?.gestures || {};
    leftContainer.innerHTML = Object.entries(leftGestures).map(([key, item]) => `
      <div class="mapping-card">
        <div class="mapping-card-header">
          <span>Gesture: ${item.label || 'Degree ' + key}</span>
        </div>
        <div class="setting-row">
          <span class="setting-label">MIDI Note</span>
          <input type="number" class="setting-input left-note-input" data-key="${key}" min="0" max="127" value="${item.note || 60}" style="width: 65px;">
          <span style="font-size: 11px; color: #888;">(${midiNoteToName(item.note || 60)})</span>
        </div>
      </div>
    `).join("");
  }

  // Render Right Hand Gestures UI Cards
  const rightContainer = document.getElementById("rightGestureContainer");
  if (rightContainer) {
    const rightGestures = currentConfig.rightHand?.gestures || {};
    rightContainer.innerHTML = Object.entries(rightGestures).map(([key, item]) => `
      <div class="mapping-card">
        <div class="mapping-card-header">
          <span>Voicing ${key}: ${item.label || 'CC Trigger ' + key}</span>
        </div>
        <div class="setting-row">
          <span class="setting-label">MIDI CC Number</span>
          <input type="number" class="setting-input right-cc-input" data-key="${key}" min="0" max="127" value="${item.ccNumber || (19 + Number(key))}" style="width: 65px;">
        </div>
      </div>
    `).join("");
  }

  // Bind settings change listeners ONCE
  bindSettingsEventsOnce(midi, synth);
}

/**
 * Attaches event listeners for settings modal inputs, preset buttons, and tabs EXACTLY ONCE.
 *
 * @param {MidiEngine} midi Web MIDI engine instance.
 * @param {SynthEngine} synth Web Audio synth instance.
 */
function bindSettingsEventsOnce(midi, synth) {
  if (isEventsBound) return;
  isEventsBound = true;

  // MIDI Enabled
  document.getElementById("cfgMidiEnabled")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    currentConfig.midiEnabled = e.target.checked;
    midi.setEnabled(currentConfig.midiEnabled);
    updateKeyboardMidiState(currentConfig.midiEnabled);
  });

  // Audio Enabled
  document.getElementById("cfgAudioEnabled")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    currentConfig.audioEnabled = e.target.checked;
    if (!currentConfig.audioEnabled) synth.stop();
  });

  // MIDI Channel
  document.getElementById("cfgMidiChannelSelect")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    currentConfig.midiChannel = parseInt(e.target.value, 10);
    midi.setChannel(currentConfig.midiChannel);
  });

  // MIDI Output Device
  document.getElementById("cfgMidiOutputSelect")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    currentConfig.selectedMidiOutput = e.target.value;
    midi.setOutput(currentConfig.selectedMidiOutput);
  });

  // Master Volume
  document.getElementById("cfgMasterVolume")?.addEventListener("input", (e) => {
    const currentConfig = getCurrentConfig();
    currentConfig.masterVolume = parseFloat(e.target.value);
  });

  // Left Hand Send Chords & Transpose
  document.getElementById("cfgLeftSendChords")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.leftHand) currentConfig.leftHand = {};
    currentConfig.leftHand.sendChords = e.target.checked;
  });

  document.getElementById("cfgLeftTranspose")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.leftHand) currentConfig.leftHand = {};
    currentConfig.leftHand.transpose = parseInt(e.target.value, 10) || 0;
  });

  // Left Hand Tilt
  document.getElementById("cfgLeftTiltEnabled")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.leftHand) currentConfig.leftHand = {};
    if (!currentConfig.leftHand.tilt) currentConfig.leftHand.tilt = {};
    currentConfig.leftHand.tilt.enabled = e.target.checked;
  });

  document.getElementById("cfgLeftTiltCC")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.leftHand) currentConfig.leftHand = {};
    if (!currentConfig.leftHand.tilt) currentConfig.leftHand.tilt = {};
    currentConfig.leftHand.tilt.ccNumber = parseInt(e.target.value, 10);
  });

  // Right Hand Tilt
  document.getElementById("cfgRightTiltEnabled")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.tilt) currentConfig.rightHand.tilt = {};
    currentConfig.rightHand.tilt.enabled = e.target.checked;
  });

  document.getElementById("cfgRightTiltMode")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.tilt) currentConfig.rightHand.tilt = {};
    currentConfig.rightHand.tilt.mode = e.target.value;
  });

  document.getElementById("cfgRightTiltInvert")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.tilt) currentConfig.rightHand.tilt = {};
    currentConfig.rightHand.tilt.invert = e.target.checked;
  });

  document.getElementById("cfgRightTiltCC")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.tilt) currentConfig.rightHand.tilt = {};
    currentConfig.rightHand.tilt.ccNumber = parseInt(e.target.value, 10);
  });

  document.getElementById("cfgRightTiltMinVal")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.tilt) currentConfig.rightHand.tilt = {};
    currentConfig.rightHand.tilt.minVal = Math.max(0, Math.min(127, parseInt(e.target.value, 10) || 0));
  });

  document.getElementById("cfgRightTiltMaxVal")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.tilt) currentConfig.rightHand.tilt = {};
    currentConfig.rightHand.tilt.maxVal = Math.max(0, Math.min(127, parseInt(e.target.value, 10) || 127));
  });

  // Right Hand Height
  document.getElementById("cfgRightHeightEnabled")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.height) currentConfig.rightHand.height = {};
    currentConfig.rightHand.height.enabled = e.target.checked;
  });

  document.getElementById("cfgRightHeightCC")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.height) currentConfig.rightHand.height = {};
    currentConfig.rightHand.height.ccNumber = parseInt(e.target.value, 10);
  });

  document.getElementById("cfgRightHeightMinVal")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.height) currentConfig.rightHand.height = {};
    currentConfig.rightHand.height.minVal = Math.max(0, Math.min(127, parseInt(e.target.value, 10) || 0));
  });

  document.getElementById("cfgRightHeightMaxVal")?.addEventListener("change", (e) => {
    const currentConfig = getCurrentConfig();
    if (!currentConfig.rightHand) currentConfig.rightHand = {};
    if (!currentConfig.rightHand.height) currentConfig.rightHand.height = {};
    currentConfig.rightHand.height.maxVal = Math.max(0, Math.min(127, parseInt(e.target.value, 10) || 127));
  });

  // Event Delegation for Left Hand Gesture Note Inputs
  document.getElementById("leftGestureContainer")?.addEventListener("change", (e) => {
    if (e.target && e.target.classList.contains("left-note-input")) {
      const key = e.target.dataset.key;
      const val = parseInt(e.target.value, 10);
      const currentConfig = getCurrentConfig();
      if (currentConfig.leftHand?.gestures[key]) {
        currentConfig.leftHand.gestures[key].note = val;
      }
    }
  });

  // Event Delegation for Right Hand Gesture CC Inputs
  document.getElementById("rightGestureContainer")?.addEventListener("change", (e) => {
    if (e.target && e.target.classList.contains("right-cc-input")) {
      const key = e.target.dataset.key;
      const val = parseInt(e.target.value, 10);
      const currentConfig = getCurrentConfig();
      if (currentConfig.rightHand?.gestures[key]) {
        currentConfig.rightHand.gestures[key].ccNumber = val;
      }
    }
  });

  // Tab switching logic (scoped per modal card container)
  document.querySelectorAll(".modal-card").forEach(modal => {
    modal.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        modal.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        modal.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const paneId = `tab-${btn.dataset.tab}`;
        modal.querySelector(`#${paneId}`)?.classList.add("active");
      });
    });
  });

  // Preset Select Change - Shows Apply Preset button if different from active
  document.getElementById("cfgPresetSelect")?.addEventListener("change", (e) => {
    const selectedId = e.target.value;
    const currentConfig = getCurrentConfig();
    const applyPresetRow = document.getElementById("applyPresetRow");
    if (applyPresetRow) {
      applyPresetRow.style.display = (selectedId !== currentConfig.id) ? "flex" : "none";
    }
  });

  // Apply Selected Preset Button
  document.getElementById("btnApplyPreset")?.addEventListener("click", () => {
    const presetSelect = document.getElementById("cfgPresetSelect");
    if (!presetSelect) return;

    const selectedId = presetSelect.value;
    const pState = getPresetState();
    pState.activePresetId = selectedId;

    savePresetState();
    loadPresetState();
    setupSettingsUI(midi, synth);
    applyConfigToEngines(midi);

    const activeCfg = getCurrentConfig();
    alert(`Preset "${activeCfg.name}" applied successfully!`);
  });

  // Save Current Preset Button
  document.getElementById("btnSavePreset")?.addEventListener("click", () => {
    const currentConfig = getCurrentConfig();
    savePresetState();
    alert(`Configuration saved for preset "${currentConfig.name}"!`);
  });

  // Save As New Preset Button
  document.getElementById("btnSaveAsPreset")?.addEventListener("click", () => {
    const currentConfig = getCurrentConfig();
    const presetName = prompt("Enter a name for your new preset:", `${currentConfig.name} Copy`);
    if (!presetName || !presetName.trim()) return;

    const presetState = getPresetState();
    const newId = "preset_" + Date.now();
    const newPreset = JSON.parse(JSON.stringify(currentConfig));
    newPreset.id = newId;
    newPreset.name = presetName.trim();

    presetState.presets.push(newPreset);
    presetState.activePresetId = newId;

    savePresetState();
    loadPresetState();
    setupSettingsUI(midi, synth);
    applyConfigToEngines(midi);
    alert(`New preset "${newPreset.name}" created and saved successfully!`);
  });

  // Reset Presets Button
  document.getElementById("btnResetPresets")?.addEventListener("click", () => {
    if (confirm("Reset configuration to default presets.json?")) {
      localStorage.removeItem("gesture_synth_config");
      setPresetState(defaultPresetData);
      setCurrentConfig(defaultPresetData.presets[0]);
      setupSettingsUI(midi, synth);
      applyConfigToEngines(midi);
      alert("Presets reset to default.");
    }
  });

  // Export JSON
  document.getElementById("btnExportJSON")?.addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(getPresetState(), null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "presets.json");
    dlAnchorElem.click();
  });

  // Import JSON
  document.getElementById("btnImportJSON")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (importedData && importedData.presets) {
          setPresetState(importedData);
          savePresetState();
          loadPresetState();
          setupSettingsUI(midi, synth);
          applyConfigToEngines(midi);
          alert("Presets imported successfully!");
        } else {
          alert("Invalid preset JSON format.");
        }
      } catch (err) {
        alert("Error parsing JSON file.");
      }
    };
    reader.readAsText(file);
  });
}

/**
 * Initializes modal open/close buttons, help guide dialogs, and start overlay event listeners.
 *
 * @param {MidiEngine} midi Web MIDI engine instance.
 * @param {SynthEngine} synth Web Audio synth instance.
 * @param {HTMLElement} startOverlayEl Start overlay DOM element.
 * @param {HTMLCanvasElement} canvasEl Overlay canvas element.
 */
export function initModalListeners(midi, synth, startOverlayEl, canvasEl) {
  // Bind settings & help modal event listeners immediately on app initialization
  bindSettingsEventsOnce(midi, synth);

  const settingsButton = document.getElementById("settingsButton");
  const settingsModal = document.getElementById("settingsModal");
  const closeSettings = document.getElementById("closeSettings");

  const helpButton = document.getElementById("helpButton");
  const helpModal = document.getElementById("helpModal");
  const closeHelp = document.getElementById("closeHelp");

  // Settings Modal bindings
  settingsButton?.addEventListener("click", () => {
    setupSettingsUI(midi, synth);
    settingsModal?.classList.remove("hidden");
  });

  closeSettings?.addEventListener("click", (e) => {
    e.stopPropagation();
    settingsModal?.classList.add("hidden");
    savePresetState();
  });

  settingsModal?.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      settingsModal?.classList.add("hidden");
      savePresetState();
    }
  });

  // Help Modal bindings
  helpButton?.addEventListener("click", () => {
    helpModal?.classList.remove("hidden");
  });

  closeHelp?.addEventListener("click", (e) => {
    e.stopPropagation();
    helpModal?.classList.add("hidden");
  });

  helpModal?.addEventListener("click", (e) => {
    if (e.target === helpModal) {
      helpModal?.classList.add("hidden");
    }
  });

  // Start overlay click handler
  startOverlayEl?.addEventListener("click", async () => {
    synth.ensureContext();
    await midi.init();
    applyConfigToEngines(midi);
    startOverlayEl.style.display = "none";
    canvasEl?.classList.remove("dimmed");
  });
}
