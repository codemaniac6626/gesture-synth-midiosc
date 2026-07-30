/**
 * @file main.js
 * @description Main application entrypoint for Gesture Synth.
 * Orchestrates MediaPipe HandLandmarker initialization, webcam video capture, real-time animation loop,
 * gesture recognition, Web Audio synthesis, and Web MIDI message transmission.
 */

import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { inject } from "@vercel/analytics";

import { MidiEngine } from "./midi.js";
import { synth } from "./src/synthEngine.js";
import { getCurrentConfig } from "./src/config.js";
import { 
  freqToMidiNote, 
  getChordName, 
  getChordTones, 
  getSolidNotes, 
  NUMERAL_TO_DEGREE, 
  DEGREE_SEMITONES 
} from "./src/musicTheory.js";
import { 
  classifyChord, 
  getHandHorizontalTilt, 
  getVolumeFromHeight, 
  getRightHandQualityIndex, 
  isThumbExtended 
} from "./src/gestures.js";
import { stabilizeChordState } from "./src/stabilizer.js";
import { drawEnergy, drawFrame } from "./src/visualizer.js";
import { updateVolumeMeter, initModalListeners } from "./src/uiController.js";

// Initialize Vercel Analytics
inject();

// ---- DOM References ----
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("overlay");
const ctx = canvasEl.getContext("2d");

const chordDisplayEl = document.getElementById("chordDisplay");
const volumeBarEls = Array.from(document.querySelectorAll(".vol-bar"));
const qualityDisplayEl = document.getElementById("qualityDisplay");
const startOverlayEl = document.getElementById("startOverlay");

const midiLed = document.getElementById("midiLed");
const midiStatusBadge = document.getElementById("midiStatusBadge");
const midiStatusText = document.getElementById("midiStatusText");

const keySelectEl = document.getElementById("keySelect");
const toneSelectEl = document.getElementById("toneSelect");

// ---- Web MIDI Engine Initialization ----
const midi = new MidiEngine();

// ---- Key & Tone State Variables ----
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
    const activePortName = status.outputs.find((o) => o.id === status.selectedOutputId)?.name || "All Devices";
    midiStatusText.textContent = `MIDI: ${activePortName}`;
  }

  // Update Settings modal device dropdown selector
  const outputSelect = document.getElementById("cfgMidiOutputSelect");
  if (outputSelect) {
    const currentConfig = getCurrentConfig();
    outputSelect.innerHTML = status.outputs
      .map((o) => `<option value="${o.id}" ${o.id === currentConfig.selectedMidiOutput ? "selected" : ""}>${o.name}</option>`)
      .join("");
  }
});

midi.onActivity(() => {
  midiLed.classList.add("flash");
  setTimeout(() => midiLed.classList.remove("flash"), 80);
});

// Initialize UI Modal listeners & start overlay handler
initModalListeners(midi, synth, startOverlayEl, canvasEl);

/**
 * Requests webcam media stream access and binds it to the video DOM element.
 * @returns {Promise<void>} Resolves when video metadata has loaded and playback begins.
 */
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

/**
 * Initializes MediaPipe HandLandmarker model using GPU acceleration.
 * @returns {Promise<HandLandmarker>} Configured HandLandmarker instance.
 */
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

/**
 * Resizes overlay canvas to fit current viewport dimensions.
 */
function resizeCanvas() {
  canvasEl.width = window.innerWidth;
  canvasEl.height = window.innerHeight;
}

/**
 * Main application boot function.
 * Sets up camera, canvas resizing, hand tracking, and starts requestAnimationFrame loop.
 */
async function main() {
  await setupCamera();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const handLandmarker = await setupHandLandmarker();
  let lastVideoTime = -1;

  let cachedLeftLandmarks = null;
  let cachedRightLandmarks = null;

  /**
   * Continuous animation frame loop for real-time tracking, synthesis, and MIDI transmission.
   */
  function loop() {
    const timestampNow = performance.now();
    const currentConfig = getCurrentConfig();

    // 1. Detect hand landmarks on video frame update
    if (videoEl.currentTime !== lastVideoTime) {
      lastVideoTime = videoEl.currentTime;

      const results = handLandmarker.detectForVideo(videoEl, timestampNow);
      drawFrame(videoEl, ctx, results, canvasEl.width, canvasEl.height);

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

    // 2. LEFT HAND PROCESSING: Scale degree & chord root classification
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

    // 3. RIGHT HAND PROCESSING: Voicing trigger count, vertical height volume, & horizontal tilt CC
    if (cachedRightLandmarks) {
      rawQualityIndex = getRightHandQualityIndex(cachedRightLandmarks);
      rawThumbDown = isThumbExtended(cachedRightLandmarks, "Right");

      // Height -> Master Volume / Expression CC
      const currentVolume = getVolumeFromHeight(cachedRightLandmarks, currentConfig.rightHand?.height);
      updateVolumeMeter(currentVolume, volumeBarEls);

      if (currentConfig.midiEnabled && currentConfig.rightHand?.height?.enabled) {
        const ccNum = currentConfig.rightHand.height.ccNumber || 7;
        const ccVal = Math.round(currentVolume * 127);
        midi.sendCC(ccNum, ccVal);
      }

      // Horizontal Tilt -> Filter Sweep / DAW Knob CC
      const horizontalTilt = getHandHorizontalTilt(cachedRightLandmarks, "Right");
      const tiltPercentage = Math.round(horizontalTilt * 100);

      const targetEl = document.getElementById("distortionDisplay");
      if (targetEl) {
        targetEl.textContent = `Filter: ${tiltPercentage > 0 ? "+" : ""}${tiltPercentage}%`;
      }
      synth.updateFilterSweep(horizontalTilt);

      if (currentConfig.midiEnabled && currentConfig.rightHand?.tilt?.enabled) {
        const ccNum = currentConfig.rightHand.tilt.ccNumber || 1;
        const minVal = currentConfig.rightHand.tilt.minVal ?? 0;
        const maxVal = currentConfig.rightHand.tilt.maxVal ?? 127;
        const normTilt = (horizontalTilt + 1) / 2;
        const ccVal = Math.round(minVal + normTilt * (maxVal - minVal));
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

    // 4. Combine raw gesture state and stabilize across frames
    if (rawChord) {
      rawChordState = {
        chord: rawChord,
        isMajorMode: rawMode,
        qualityIndex: rawQualityIndex,
        thumbDown: rawThumbDown,
      };
    }

    const stableState = stabilizeChordState(rawChordState, timestampNow);
    if (stableState) {
      currentChord = stableState.chord;
      isMajorMode = stableState.isMajorMode;
      qualityIndex = stableState.qualityIndex;
      thumbDown = stableState.thumbDown;
    }

    // 5. Update UI Displays
    if (currentChord) {
      const chordName = getChordName(currentChord, isMajorMode, currentKeyName);
      chordDisplayEl.textContent = `${chordName}(${currentChord})`;
    } else {
      chordDisplayEl.textContent = "--";
    }

    const MAJOR_LABELS = { 1: "Major", 2: "Major 1st Inv", 3: "Major 7th", 4: "Dominant 7th" };
    const MINOR_LABELS = { 1: "Minor", 2: "Minor 1st Inv", 3: "Minor 7th", 4: "Diminished 7th" };
    const activeLabel = isMajorMode ? MAJOR_LABELS[qualityIndex] : MINOR_LABELS[qualityIndex];

    qualityDisplayEl.textContent = activeLabel ? `${activeLabel}${thumbDown ? " (-8ve)" : ""}` : "--";

    // 6. Audio Synthesis & MIDI Output Execution
    if (cachedRightLandmarks && currentChord && qualityIndex >= 1) {
      const tones = getChordTones(currentChord, isMajorMode, currentTonicFreq);
      let freqs = getSolidNotes(tones, qualityIndex, isMajorMode);
      if (thumbDown) freqs = freqs.map((f) => f / 2);

      const leftTranspose = currentConfig.leftHand?.transpose || 0;
      if (leftTranspose !== 0) {
        freqs = freqs.map((f) => f * Math.pow(2, leftTranspose / 12));
      }

      const currentVolume = getVolumeFromHeight(cachedRightLandmarks, currentConfig.rightHand?.height);

      // Play sound in Web Audio synth if enabled
      if (currentConfig.audioEnabled) {
        synth.playNotes(freqs, currentConfig, currentWaveform);
        synth.setVolume(currentVolume, currentConfig);
      } else {
        synth.setVolume(0, currentConfig);
      }

      // Send MIDI Notes if MIDI is enabled
      if (currentConfig.midiEnabled) {
        if (currentConfig.leftHand?.sendChords) {
          const midiNotes = freqs.map((f) => freqToMidiNote(f));
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
      synth.setVolume(0, currentConfig);
      midi.allNotesOff();
    }

    // 7. Visual Energy Canvas Wave Drawing
    const volume = cachedRightLandmarks ? getVolumeFromHeight(cachedRightLandmarks, currentConfig.rightHand?.height) : 0;
    const tilt = cachedRightLandmarks ? getHandHorizontalTilt(cachedRightLandmarks, "Right") : 0;
    drawEnergy(ctx, volume, qualityIndex, tilt, currentChord);

    requestAnimationFrame(loop);
  }

  loop();
}

main().catch((err) => console.error(err));
