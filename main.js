import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { inject } from "@vercel/analytics";
import { MidiEngine } from "./midi.js";
import defaultPresetData from "./presets.json";

inject();

// ---- DOM References ----
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("overlay");
const ctx = canvasEl.getContext("2d");

const chordDisplayEl = document.getElementById("chordDisplay");
const volumeBarEls = Array.from(document.querySelectorAll(".vol-bar"));
const qualityDisplayEl = document.getElementById("qualityDisplay");
const startOverlayEl = document.getElementById("startOverlay");

const helpButton = document.getElementById("helpButton");
const helpModal = document.getElementById("helpModal");
const closeHelp = document.getElementById("closeHelp");

const settingsButton = document.getElementById("settingsButton");
const settingsModal = document.getElementById("settingsModal");
const closeSettings = document.getElementById("closeSettings");

const midiLed = document.getElementById("midiLed");
const midiStatusBadge = document.getElementById("midiStatusBadge");
const midiStatusText = document.getElementById("midiStatusText");

const keySelectEl = document.getElementById("keySelect");
const toneSelectEl = document.getElementById("toneSelect");

// ---- Web MIDI Engine Initialization ----
const midi = new MidiEngine();

// ---- Preset & Configuration Management ----
let presetState = null;
let currentConfig = null;

function loadPresetState() {
  const saved = localStorage.getItem("gesture_synth_config");
  if (saved) {
    try {
      presetState = JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to parse saved presets, using defaults:", e);
      presetState = defaultPresetData;
    }
  } else {
    presetState = defaultPresetData;
  }

  // Find active preset
  const activeId = presetState.activePresetId || presetState.presets[0].id;
  currentConfig = presetState.presets.find(p => p.id === activeId) || presetState.presets[0];

  // Auto-migrate gestures 6 and 7 for all presets
  presetState.presets.forEach(p => {
    if (p.leftHand && p.leftHand.gestures) {
      if (!p.leftHand.gestures["6"]) {
        p.leftHand.gestures["6"] = p.leftHand.gestures["VI"] || { type: "note", note: 69, velocity: 100, label: "Degree VI / A4" };
      }
      if (!p.leftHand.gestures["7"]) {
        p.leftHand.gestures["7"] = p.leftHand.gestures["VII"] || { type: "note", note: 71, velocity: 100, label: "Degree VII / B4" };
      }
    }
  });
}

function savePresetState() {
  localStorage.setItem("gesture_synth_config", JSON.stringify(presetState));
}

loadPresetState();

// ---- MIDI Helper: Convert Frequency (Hz) to MIDI Note Number ----
function freqToMidiNote(freq) {
  if (!freq || freq <= 0) return 60;
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

// Convert MIDI Note Number to Name (e.g. 60 -> C4)
function midiNoteToName(noteNum) {
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(noteNum / 12) - 1;
  const name = notes[noteNum % 12];
  return `${name}${octave}`;
}

// ---- Finger Landmark Indices ----
const FINGERS = {
  index:  { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring:   { pip: 14, tip: 16 },
  pinky:  { pip: 18, tip: 20 },
};

function isFingerExtended(landmarks, name) {
  const { pip, tip } = FINGERS[name];
  return landmarks[tip].y < landmarks[pip].y;
}

function isThumbExtended(landmarks, handedness) {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  return handedness === "Right" ? (thumbTip.x > thumbIp.x) : (thumbTip.x < thumbIp.x);
}

function getChordQuality(landmarks) {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  return middleMcp.x > wrist.x ? "minor" : "major";
}

function classifyChord(landmarks, handedness) {
  const thumb = isThumbExtended(landmarks, handedness);
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");

  const quality = getChordQuality(landmarks);

  if (index && pinky && !middle && !ring && !thumb) {
    return quality === "major" ? "VI" : "vi";
  }

  if (index && pinky && !middle && !ring && thumb) {
    return quality === "major" ? "VII" : "vii";
  }

  const count = [thumb, index, middle, ring, pinky].filter(Boolean).length;
  const ROMAN = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };
  const base = ROMAN[count];
  if (!base) return null;

  return quality === "major" ? base : base.toLowerCase();
}

function getHandHorizontalTilt(landmarks, handedness) {
  if (!landmarks || landmarks.length < 18) return 0;
  try {
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    const ringMcp = landmarks[13];
    if (!wrist || !middleMcp || !ringMcp) return 0;

    const minX = Math.min(middleMcp.x, ringMcp.x);
    const maxX = Math.max(middleMcp.x, ringMcp.x);
    let tiltFactor = 0;
    const MAX_TRAVEL = 0.12;

    if (wrist.x < minX) {
      tiltFactor = (wrist.x - minX) / MAX_TRAVEL;
    } else if (wrist.x > maxX) {
      tiltFactor = (wrist.x - maxX) / MAX_TRAVEL;
    } else {
      tiltFactor = 0;
    }

    tiltFactor = Math.max(-1, Math.min(1, tiltFactor));
    if (handedness === "Right") {
      tiltFactor = -tiltFactor;
    }
    return tiltFactor;
  } catch (error) {
    console.error("Tilt calculation failed:", error);
    return 0;
  }
}

// ---- Canvas Audio Wave Visualizer ----
function drawEnergy(ctx, volume01, qualityIndex, tiltFactor, chordStr) {
  if (!ctx) return;
  if (qualityIndex === 0) return;
  const lineCount = qualityIndex;

  try {
    const centerY = ctx.canvas.height - 56;
    const canvasWidth = ctx.canvas.width;
    const maxThickness = 1 + (volume01 * 8);

    const chaosScale = (tiltFactor + 1) / 2;
    const shakinessAmp = chaosScale * 25;
    const shakinessFreq = 0.05 + (chaosScale * 0.15);

    let baseColorRGB = "150, 150, 150";
    let isChordActive = false;
    let isMajor = false;

    if (chordStr && chordStr !== "--") {
      isChordActive = true;
      const upperStr = chordStr.toUpperCase();
      isMajor = (chordStr === upperStr);

      const SCALE_COLORS = {
        "I":   "232, 161, 61",
        "II":  "210, 50, 120",
        "III": "180, 40, 150",
        "IV":  "240, 210, 40",
        "V":   "245, 120, 30",
        "VI":  "230, 40, 40",
        "VII": "100, 200, 250"
      };
      baseColorRGB = SCALE_COLORS[upperStr] || "232, 161, 61";
    }

    const brightnessAlpha = isChordActive ? (isMajor ? 1 : 0.70) : 0.3;

    ctx.save();
    const time = performance.now() * 0.004;
    const colorChannels = baseColorRGB.split(",");
    const r = parseInt(colorChannels[0]);
    const g = parseInt(colorChannels[1]);
    const b = parseInt(colorChannels[2]);

    ctx.shadowBlur = 10 + (volume01 * 20);
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.5 * brightnessAlpha})`;

    for (let l = 0; l < lineCount; l++) {
      ctx.beginPath();
      const lineYOffset = centerY + (l - (lineCount - 1) / 2) * 12;

      for (let x = 0; x <= canvasWidth; x += 10) {
        const baseSine = Math.sin(x * 0.005 + time + l * 0.5) * 20;
        const jitter = (Math.random() - 0.5) * shakinessAmp * Math.sin(x * shakinessFreq + time);
        const y = lineYOffset + baseSine + jitter;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${brightnessAlpha})`;
      ctx.lineWidth = Math.max(1, maxThickness - (l * 0.5));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.restore();
  } catch (error) {
    console.error("Wave animation failed:", error);
  }
}

// ---- Stabilizers ----
const CHORD_HOLD_TIME_MS = 100;
const VIBE_NULL_WINDOW_MS = 50;

let stableChordState = null;
let candidateChordState = null;
let candidateChordSince = 0;
let lastChordSeenValidTime = 0;

function sameChordState(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.chord === b.chord &&
    a.isMajorMode === b.isMajorMode &&
    a.qualityIndex === b.qualityIndex &&
    a.thumbDown === b.thumbDown
  );
}

function stabilizeChordState(rawState, now) {
  if (rawState !== null) lastChordSeenValidTime = now;
  let effectiveState = rawState;

  if (rawState === null && now - lastChordSeenValidTime < VIBE_NULL_WINDOW_MS) {
    effectiveState = candidateChordState;
  }

  if (!sameChordState(effectiveState, candidateChordState)) {
    candidateChordState = effectiveState;
    candidateChordSince = now;
  }

  if (now - candidateChordSince >= CHORD_HOLD_TIME_MS) {
    stableChordState = candidateChordState;
  }

  return stableChordState;
}

function getVolumeFromHeight(landmarks) {
  const wrist = landmarks[0];
  const TOP = 0.05;
  const BOTTOM = 0.95;
  const clamped = Math.max(TOP, Math.min(BOTTOM, wrist.y));
  const t = (clamped - TOP) / (BOTTOM - TOP);
  return 1 - t;
}

function updateVolumeMeter(volume01) {
  const litCount = Math.round(volume01 * volumeBarEls.length);
  volumeBarEls.forEach((bar) => {
    const index = Number(bar.dataset.index);
    bar.classList.toggle("lit", index >= volumeBarEls.length - litCount);
  });
}

function getRightHandQualityIndex(landmarks) {
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");
  return [index, middle, ring, pinky].filter(Boolean).length;
}

// ---- Camera & MediaPipe Setup ----
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false,
  });
  videoEl.srcObject = stream;
  return new Promise((resolve) => {
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      resolve();
    };
  });
}

async function setupHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

// ---- Frequencies & Scale Calculations ----
const DEGREE_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };

let currentTonicFreq = Number(keySelectEl.value);
let currentKeyName = keySelectEl.selectedOptions[0].dataset.note;

keySelectEl.addEventListener("change", () => {
  currentTonicFreq = Number(keySelectEl.value);
  currentKeyName = keySelectEl.selectedOptions[0].dataset.note;
});

let currentWaveform = toneSelectEl.value;
toneSelectEl.addEventListener("change", () => {
  currentWaveform = toneSelectEl.value;
  synth.currentKey = null;
});

function getDegreeFreq(degree) {
  const semitones = DEGREE_SEMITONES[degree] ?? 0;
  let tonic = currentTonicFreq;
  if (tonic === 369.99 || tonic === 392.00 || tonic === 415.30) {
    tonic /= 2;
  }
  return tonic * Math.pow(2, semitones / 12);
}

const NUMERAL_TO_DEGREE = { 
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7,
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7
};
const MAJOR_SCALE = {
  A:  ["A","B","C#","D","E","F#","G#"],
  Bb: ["Bb","C","D","Eb","F","G","A"],
  B:  ["B","C#","D#","E","F#","G#","A#"],
  C:  ["C","D","E","F","G","A","B"],
  Db: ["Db","Eb","F","Gb","Ab","Bb","C"],
  D:  ["D","E","F#","G","A","B","C#"],
  Eb: ["Eb","F","G","Ab","Bb","C","D"],
  E:  ["E","F#","G#","A","B","C#","D#"],
  F:  ["F","G","A","Bb","C","D","E"],
  Gb: ["Gb","Ab","Bb","Cb","Db","Eb","F"],
  G:  ["G","A","B","C","D","E","F#"],
  Ab: ["Ab","Bb","C","Db","Eb","F","G"]
};

function getChordName(roman, isMajorMode) {
  if (!roman || roman === "--") return "";
  const degree = NUMERAL_TO_DEGREE[roman.toUpperCase()];
  if (!degree) return "";
  const root = MAJOR_SCALE[currentKeyName][degree - 1];
  return isMajorMode ? root : root + "m";
}

function getChordTones(numeralStr, isMajorMode) {
  if (!numeralStr || numeralStr === "--") return null;
  const degree = NUMERAL_TO_DEGREE[numeralStr.toUpperCase()];
  if (!degree) return null;

  const root = getDegreeFreq(degree);
  const thirdSemitones = isMajorMode ? 4 : 3;
  const fifthSemitones = 7;

  const maj7Semitones = 11;
  const dom7Semitones = 10;
  const dim7Semitones = 9;

  const third = root * Math.pow(2, thirdSemitones / 12);
  const fifth = root * Math.pow(2, fifthSemitones / 12);
  
  const octaveRoot = root * 2;
  const octaveThird = third * 2;

  const maj7Tone = root * Math.pow(2, maj7Semitones / 12);
  const dom7Tone = root * Math.pow(2, dom7Semitones / 12);
  const dim7Tone = root * Math.pow(2, dim7Semitones / 12);
  const dim5Tone = root * Math.pow(2, 6 / 12);

  return { 
    root, third, fifth, octaveRoot, octaveThird, 
    maj7Tone, dom7Tone, dim7Tone, dim5Tone 
  };
}

function getSolidNotes(tones, rightHandCount, isMajorMode) {
  if (!tones) return [];
  const { 
    root, third, fifth, octaveRoot, octaveThird, 
    maj7Tone, dom7Tone, dim7Tone, dim5Tone 
  } = tones;

  if (isMajorMode) {
    switch (rightHandCount) {
      case 1: return [root, fifth, octaveRoot, octaveThird];
      case 2: return [third, fifth, octaveRoot, octaveThird];
      case 3: return [root, third, fifth, maj7Tone];
      case 4: return [root, third, fifth, dom7Tone];
      default: return [root, fifth, octaveRoot, octaveThird];
    }
  } else {
    switch (rightHandCount) {
      case 1: return [root, fifth, octaveRoot, octaveThird];
      case 2: return [third, fifth, octaveRoot, octaveThird];
      case 3: return [root, third, fifth, dom7Tone]; 
      case 4: return [root, third, dim5Tone, dim7Tone];
      default: return [root, fifth, octaveRoot, octaveThird];
    }
  }
}

// ---- Synth Engine ----
class SynthEngine {
  constructor() {
    this.ctx = null;
    this.filter = null;
    this.waveShaper = null;
    this.masterGain = null;
    this.oscillators = [];
    this.currentKey = null;
  }

  ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.waveShaper = this.ctx.createWaveShaper();
    this.waveShaper.curve = null;
    this.waveShaper.oversample = "4x";

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 0.7;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;

    this.waveShaper.connect(this.filter);
    this.filter.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  updateVolume(volume01) {
    if (!this.ctx) return;
    const targetGain = currentConfig.audioEnabled ? (volume01 * (currentConfig.masterVolume ?? 0.8)) : 0;
    this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.03);
  }

  setVolume(volume01) {
    if (!this.ctx) return;
    const targetGain = currentConfig.audioEnabled ? (volume01 * (currentConfig.masterVolume ?? 0.8)) : 0;
    const clamped = Math.max(0, Math.min(1, targetGain));
    this.masterGain.gain.linearRampToValueAtTime(clamped, this.ctx.currentTime + 0.05);
  }

  updateFilterSweep(tiltFactor) {
    if (!this.filter || !this.ctx) return;
    let targetFrequency = 1200;
    let targetQ = 0.7;

    if (tiltFactor < 0) {
      const intensity = Math.abs(tiltFactor); 
      targetFrequency = 1200 - (intensity * 950);
      targetQ = 0.7 + (intensity * 1.5);
    } else if (tiltFactor > 0) {
      targetFrequency = 1200 + (tiltFactor * 3800);
      targetQ = 0.7 + (tiltFactor * 4.5);
    }

    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(targetFrequency, now, 0.04);
    this.filter.Q.setTargetAtTime(targetQ, now, 0.04);
  }

  playNotes(freqs) {
    if (!this.ctx || !currentConfig.audioEnabled || freqs.length === 0) return;
    const key = freqs.map((f) => f.toFixed(1)).join(",");
    if (key === this.currentKey) return;

    this.oscillators.forEach((osc) => { try { osc.stop(); } catch {} });
    this.oscillators = freqs.map((freq) => {
      const osc = this.ctx.createOscillator();
      osc.type = currentWaveform;
      osc.frequency.value = freq;
      osc.connect(this.waveShaper);
      osc.start();
      return osc;
    });
    this.currentKey = key;
  }

  stop() {
    this.setVolume(0);
    this.oscillators.forEach((osc) => { try { osc.stop(); } catch {} });
    this.oscillators = [];
    this.currentKey = null;
  }
}

const synth = new SynthEngine();

// ---- Web MIDI Event Callbacks ----
midi.onStateChange((status) => {
  if (!status.isSupported) {
    midiStatusBadge.classList.remove("active");
    midiStatusText.textContent = "Web MIDI: Unsupported";
  } else if (!status.isEnabled) {
    midiStatusBadge.classList.remove("active");
    midiStatusText.textContent = "Web MIDI: Disabled";
  } else if (status.outputCount === 0) {
    midiStatusBadge.classList.remove("active");
    midiStatusText.textContent = "Web MIDI: No Output Device";
  } else {
    midiStatusBadge.classList.add("active");
    const activePortName = status.outputs.find(o => o.id === status.selectedOutputId)?.name || "All Devices";
    midiStatusText.textContent = `MIDI: ${activePortName}`;
  }

  // Update Settings dropdown for outputs
  const outputSelect = document.getElementById("cfgMidiOutputSelect");
  if (outputSelect) {
    outputSelect.innerHTML = status.outputs
      .map(o => `<option value="${o.id}" ${o.id === currentConfig.selectedMidiOutput ? "selected" : ""}>${o.name}</option>`)
      .join("");
  }
});

midi.onActivity(() => {
  midiLed.classList.add("flash");
  setTimeout(() => midiLed.classList.remove("flash"), 80);
});

// ---- Settings Modal & Form Setup ----
function setupSettingsUI() {
  // Populate MIDI Channels (1-16)
  const channelSelect = document.getElementById("cfgMidiChannelSelect");
  channelSelect.innerHTML = Array.from({ length: 16 }, (_, i) => i + 1)
    .map(c => `<option value="${c}">${c}</option>`).join("");

  // Sync controls with currentConfig
  document.getElementById("cfgMidiEnabled").checked = currentConfig.midiEnabled;
  document.getElementById("cfgAudioEnabled").checked = currentConfig.audioEnabled;
  document.getElementById("cfgMidiChannelSelect").value = currentConfig.midiChannel || 1;
  document.getElementById("cfgMasterVolume").value = currentConfig.masterVolume ?? 0.8;
  document.getElementById("cfgLeftSendChords").checked = currentConfig.leftHand?.sendChords ?? true;
  document.getElementById("cfgLeftTranspose").value = currentConfig.leftHand?.transpose ?? 0;

  document.getElementById("cfgLeftTiltEnabled").checked = currentConfig.leftHand?.tilt?.enabled ?? true;
  document.getElementById("cfgLeftTiltCC").value = currentConfig.leftHand?.tilt?.ccNumber ?? 14;

  document.getElementById("cfgRightTiltEnabled").checked = currentConfig.rightHand?.tilt?.enabled ?? true;
  document.getElementById("cfgRightTiltCC").value = currentConfig.rightHand?.tilt?.ccNumber ?? 1;

  document.getElementById("cfgRightHeightEnabled").checked = currentConfig.rightHand?.height?.enabled ?? true;
  document.getElementById("cfgRightHeightCC").value = currentConfig.rightHand?.height?.ccNumber ?? 7;

  // Render Preset selector
  const presetSelect = document.getElementById("cfgPresetSelect");
  presetSelect.innerHTML = presetState.presets
    .map(p => `<option value="${p.id}" ${p.id === currentConfig.id ? "selected" : ""}>${p.name}</option>`)
    .join("");

  // Render Left Hand Gestures UI Cards
  const leftContainer = document.getElementById("leftGestureContainer");
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

  // Render Right Hand Gestures UI Cards
  const rightContainer = document.getElementById("rightGestureContainer");
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

  // Bind settings change events
  document.getElementById("cfgMidiEnabled").addEventListener("change", (e) => {
    currentConfig.midiEnabled = e.target.checked;
    midi.setEnabled(currentConfig.midiEnabled);
  });

  document.getElementById("cfgAudioEnabled").addEventListener("change", (e) => {
    currentConfig.audioEnabled = e.target.checked;
    if (!currentConfig.audioEnabled) synth.stop();
  });

  document.getElementById("cfgMidiChannelSelect").addEventListener("change", (e) => {
    currentConfig.midiChannel = parseInt(e.target.value, 10);
    midi.setChannel(currentConfig.midiChannel);
  });

  document.getElementById("cfgMidiOutputSelect").addEventListener("change", (e) => {
    currentConfig.selectedMidiOutput = e.target.value;
    midi.setOutput(currentConfig.selectedMidiOutput);
  });

  document.getElementById("cfgMasterVolume").addEventListener("input", (e) => {
    currentConfig.masterVolume = parseFloat(e.target.value);
  });

  document.getElementById("cfgLeftSendChords").addEventListener("change", (e) => {
    if (!currentConfig.leftHand) currentConfig.leftHand = {};
    currentConfig.leftHand.sendChords = e.target.checked;
  });

  document.getElementById("cfgLeftTranspose").addEventListener("change", (e) => {
    if (!currentConfig.leftHand) currentConfig.leftHand = {};
    currentConfig.leftHand.transpose = parseInt(e.target.value, 10) || 0;
  });

  document.getElementById("cfgLeftTiltEnabled").addEventListener("change", (e) => {
    if (!currentConfig.leftHand.tilt) currentConfig.leftHand.tilt = {};
    currentConfig.leftHand.tilt.enabled = e.target.checked;
  });
  document.getElementById("cfgLeftTiltCC").addEventListener("change", (e) => {
    currentConfig.leftHand.tilt.ccNumber = parseInt(e.target.value, 10);
  });

  document.getElementById("cfgRightTiltEnabled").addEventListener("change", (e) => {
    if (!currentConfig.rightHand.tilt) currentConfig.rightHand.tilt = {};
    currentConfig.rightHand.tilt.enabled = e.target.checked;
  });
  document.getElementById("cfgRightTiltCC").addEventListener("change", (e) => {
    currentConfig.rightHand.tilt.ccNumber = parseInt(e.target.value, 10);
  });

  document.getElementById("cfgRightHeightEnabled").addEventListener("change", (e) => {
    if (!currentConfig.rightHand.height) currentConfig.rightHand.height = {};
    currentConfig.rightHand.height.enabled = e.target.checked;
  });
  document.getElementById("cfgRightHeightCC").addEventListener("change", (e) => {
    currentConfig.rightHand.height.ccNumber = parseInt(e.target.value, 10);
  });

  // Dynamic note/cc inputs binding
  document.querySelectorAll(".left-note-input").forEach(input => {
    input.addEventListener("change", (e) => {
      const key = e.target.dataset.key;
      const val = parseInt(e.target.value, 10);
      if (currentConfig.leftHand?.gestures[key]) {
        currentConfig.leftHand.gestures[key].note = val;
      }
    });
  });

  document.querySelectorAll(".right-cc-input").forEach(input => {
    input.addEventListener("change", (e) => {
      const key = e.target.dataset.key;
      const val = parseInt(e.target.value, 10);
      if (currentConfig.rightHand?.gestures[key]) {
        currentConfig.rightHand.gestures[key].ccNumber = val;
      }
    });
  });

  // Tab switching logic
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const paneId = `tab-${btn.dataset.tab}`;
      document.getElementById(paneId)?.classList.add("active");
    });
  });

  // Preset Select Change
  presetSelect.addEventListener("change", (e) => {
    presetState.activePresetId = e.target.value;
    loadPresetState();
    setupSettingsUI();
    applyConfigToEngines();
  });

  // Save Preset Button
  document.getElementById("btnSavePreset").addEventListener("click", () => {
    savePresetState();
    alert("Configuration saved successfully!");
  });

  // Reset Presets Button
  document.getElementById("btnResetPresets").addEventListener("click", () => {
    if (confirm("Reset configuration to default presets.json?")) {
      localStorage.removeItem("gesture_synth_config");
      presetState = defaultPresetData;
      currentConfig = presetState.presets[0];
      setupSettingsUI();
      applyConfigToEngines();
    }
  });

  // Export JSON
  document.getElementById("btnExportJSON").addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(presetState, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "presets.json");
    dlAnchorElem.click();
  });

  // Import JSON
  document.getElementById("btnImportJSON").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (importedData && importedData.presets) {
          presetState = importedData;
          savePresetState();
          loadPresetState();
          setupSettingsUI();
          applyConfigToEngines();
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

function applyConfigToEngines() {
  midi.setEnabled(currentConfig.midiEnabled);
  midi.setChannel(currentConfig.midiChannel || 1);
  midi.setOutput(currentConfig.selectedMidiOutput || "all");
}

// Modal open/close bindings
settingsButton.addEventListener("click", () => {
  setupSettingsUI();
  settingsModal.classList.remove("hidden");
});

closeSettings.addEventListener("click", (e) => {
  e.stopPropagation();
  settingsModal.classList.add("hidden");
  savePresetState();
});

settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.add("hidden");
    savePresetState();
  }
});

startOverlayEl.addEventListener("click", async () => {
  synth.ensureContext();
  await midi.init();
  applyConfigToEngines();
  startOverlayEl.style.display = "none";
  canvasEl.classList.remove("dimmed");
});

helpButton.addEventListener("click", () => {
  helpModal.classList.remove("hidden");
});

closeHelp.addEventListener("click", (e) => {
  e.stopPropagation();
  helpModal.classList.add("hidden");
});

helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) {
    helpModal.classList.add("hidden");
  }
});

function computeCoverRect(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;

  if (srcRatio > dstRatio) {
    const sHeight = srcH;
    const sWidth = srcH * dstRatio;
    return { sx: (srcW - sWidth) / 2, sy: 0, sWidth, sHeight };
  } else {
    const sWidth = srcW;
    const sHeight = srcW / dstRatio;
    return { sx: 0, sy: (srcH - sHeight) / 2, sWidth, sHeight };
  }
}

function drawFrame(results, canvasWidth, canvasHeight) {
  const srcW = videoEl.videoWidth;
  const srcH = videoEl.videoHeight;
  if (!srcW || !srcH) return;

  const { sx, sy, sWidth, sHeight } = computeCoverRect(srcW, srcH, canvasWidth, canvasHeight);

  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.translate(canvasWidth, 0);
  ctx.scale(-1, 1);

  ctx.drawImage(videoEl, sx, sy, sWidth, sHeight, 0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "#ffffff80";
  for (const landmarks of results.landmarks) {
    for (const point of landmarks) {
      const videoPx = point.x * srcW;
      const videoPy = point.y * srcH;
      const canvasX = ((videoPx - sx) / sWidth) * canvasWidth;
      const canvasY = ((videoPy - sy) / sHeight) * canvasHeight;

      ctx.beginPath();
      ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function resizeCanvas() {
  canvasEl.width = window.innerWidth;
  canvasEl.height = window.innerHeight;
}

// ---- Main Animation Loop ----
async function main() {
  await setupCamera();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const handLandmarker = await setupHandLandmarker();
  let lastVideoTime = -1;

  let cachedLeftLandmarks = null;
  let cachedRightLandmarks = null;

  function loop() {
    const timestampNow = performance.now();

    if (videoEl.currentTime !== lastVideoTime) {
      lastVideoTime = videoEl.currentTime;

      const results = handLandmarker.detectForVideo(videoEl, timestampNow);
      drawFrame(results, canvasEl.width, canvasEl.height);

      cachedLeftLandmarks = null;
      cachedRightLandmarks = null;

      results.landmarks.forEach((landmarks, i) => {
        const handedness = results.handedness[i][0].categoryName;
        if (handedness === "Left") cachedLeftLandmarks = landmarks;
        if (handedness === "Right") cachedRightLandmarks = landmarks;
      });
    }

    let currentChord = null;
    let isMajorMode = true;
    let qualityIndex = 0;
    let thumbDown = false;
    let rawChordState = null;

    let rawChord = null;
    let rawMode = true;
    let rawQualityIndex = 0;
    let rawThumbDown = false;

    // LEFT HAND = ROOT CHORD / NOTES
    if (cachedLeftLandmarks) {
      const leftTilt = getHandHorizontalTilt(cachedLeftLandmarks, "Left");
      rawChord = classifyChord(cachedLeftLandmarks, "Left");
      rawMode = leftTilt >= 0;

      // Optional Left Hand Tilt -> Continuous CC
      if (currentConfig.midiEnabled && currentConfig.leftHand?.tilt?.enabled) {
        const ccNum = currentConfig.leftHand.tilt.ccNumber || 14;
        const ccVal = Math.round(((leftTilt + 1) / 2) * 127);
        midi.sendCC(ccNum, ccVal);
      }
    }

    // RIGHT HAND = VOICING & CONTINUOUS CCs
    if (cachedRightLandmarks) {
      rawQualityIndex = getRightHandQualityIndex(cachedRightLandmarks);
      rawThumbDown = isThumbExtended(cachedRightLandmarks, "Right");

      // Right Hand Height -> Master Volume / Expression CC (0..127)
      const currentVolume = getVolumeFromHeight(cachedRightLandmarks);
      updateVolumeMeter(currentVolume);

      if (currentConfig.midiEnabled && currentConfig.rightHand?.height?.enabled) {
        const ccNum = currentConfig.rightHand.height.ccNumber || 7;
        const ccVal = Math.round(currentVolume * 127);
        midi.sendCC(ccNum, ccVal);
      }

      // Right Hand Horizontal Tilt -> DAW Knob Control CC (0..127)
      const horizontalTilt = getHandHorizontalTilt(cachedRightLandmarks, "Right");
      const tiltPercentage = Math.round(horizontalTilt * 100);

      const targetEl = document.getElementById("distortionDisplay");
      if (targetEl) {
        targetEl.textContent = `Filter: ${tiltPercentage > 0 ? "+" : ""}${tiltPercentage}%`;
      }
      synth.updateFilterSweep(horizontalTilt);

      if (currentConfig.midiEnabled && currentConfig.rightHand?.tilt?.enabled) {
        const ccNum = currentConfig.rightHand.tilt.ccNumber || 1;
        const ccVal = Math.round(((horizontalTilt + 1) / 2) * 127);
        midi.sendCC(ccNum, ccVal);
      }

      // Right Hand Finger Trigger CC (1..4)
      if (currentConfig.midiEnabled && rawQualityIndex >= 1 && rawQualityIndex <= 4) {
        const gestureCfg = currentConfig.rightHand?.gestures?.[rawQualityIndex];
        if (gestureCfg && gestureCfg.ccNumber !== undefined) {
          midi.sendCC(gestureCfg.ccNumber, gestureCfg.ccValue || 127);
        }
      }

      // Thumb Extension CC
      if (currentConfig.midiEnabled && rawThumbDown && currentConfig.rightHand?.thumb?.enabled) {
        const ccNum = currentConfig.rightHand.thumb.ccNumber || 24;
        midi.sendCC(ccNum, currentConfig.rightHand.thumb.ccValue || 127);
      }
    }

    // Combine raw chord state
    if (rawChord) {
      rawChordState = {
        chord: rawChord,
        isMajorMode: rawMode,
        qualityIndex: rawQualityIndex,
        thumbDown: rawThumbDown
      };
    }

    const stableState = stabilizeChordState(rawChordState, timestampNow);
    if (stableState) {
      currentChord = stableState.chord;
      isMajorMode = stableState.isMajorMode;
      qualityIndex = stableState.qualityIndex;
      thumbDown = stableState.thumbDown;
    }

    // UI Updates
    if (currentChord) {
      const chordName = getChordName(currentChord, isMajorMode);
      chordDisplayEl.textContent = `${chordName}(${currentChord})`;
    } else {
      chordDisplayEl.textContent = "--";
    }

    const MAJOR_LABELS = { 1: "Major", 2: "Major 1st Inv", 3: "Major 7th", 4: "Dominant 7th" };
    const MINOR_LABELS = { 1: "Minor", 2: "Minor 1st Inv", 3: "Minor 7th", 4: "Diminished 7th" };
    const activeLabel = isMajorMode ? MAJOR_LABELS[qualityIndex] : MINOR_LABELS[qualityIndex];

    qualityDisplayEl.textContent = activeLabel ? `${activeLabel}${thumbDown ? " (-8ve)" : ""}` : "--";

    // Audio & MIDI Output Execution
    if (cachedRightLandmarks && currentChord && qualityIndex >= 1) {
      const tones = getChordTones(currentChord, isMajorMode);
      let freqs = getSolidNotes(tones, qualityIndex, isMajorMode);
      if (thumbDown) freqs = freqs.map(f => f / 2);

      const leftTranspose = currentConfig.leftHand?.transpose || 0;
      if (leftTranspose !== 0) {
        freqs = freqs.map(f => f * Math.pow(2, leftTranspose / 12));
      }

      const currentVolume = getVolumeFromHeight(cachedRightLandmarks);

      // Play sound in Browser Audio Synth if enabled
      if (currentConfig.audioEnabled) {
        synth.playNotes(freqs);
        synth.setVolume(currentVolume);
      } else {
        synth.setVolume(0);
      }

      // Send MIDI Notes if MIDI enabled
      if (currentConfig.midiEnabled) {
        if (currentConfig.leftHand?.sendChords) {
          const midiNotes = freqs.map(f => freqToMidiNote(f));
          midi.playNotes(midiNotes, Math.round(currentVolume * 127));
        } else {
          // Single note mode per degree gesture
          const degreeKey = NUMERAL_TO_DEGREE[currentChord.toUpperCase()] || currentChord;
          const noteCfg = currentConfig.leftHand?.gestures?.[degreeKey] ||
                          currentConfig.leftHand?.gestures?.[String(degreeKey)] ||
                          currentConfig.leftHand?.gestures?.[currentChord.toUpperCase()];
          const DEFAULT_DEGREE_NOTES = { 1: 60, 2: 62, 3: 64, 4: 65, 5: 67, 6: 69, 7: 71 };
          const defaultNote = DEFAULT_DEGREE_NOTES[degreeKey] || (60 + (DEGREE_SEMITONES[degreeKey] ?? 0));
          const targetNote = (noteCfg && typeof noteCfg.note === "number") ? noteCfg.note : defaultNote;
          const finalNote = targetNote + leftTranspose + (thumbDown ? -12 : 0);
          midi.playNotes([finalNote], Math.round(currentVolume * 127));
        }
      }
    } else {
      synth.setVolume(0);
      midi.allNotesOff();
    }

    // Visual Energy Canvas Drawing
    const volume = cachedRightLandmarks ? getVolumeFromHeight(cachedRightLandmarks) : 0;
    const tilt = cachedRightLandmarks ? getHandHorizontalTilt(cachedRightLandmarks, "Right") : 0;
    drawEnergy(ctx, volume, qualityIndex, tilt, currentChord);

    requestAnimationFrame(loop);
  }

  loop();
}

main().catch((err) => console.error(err));
