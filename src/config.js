/**
 * @file config.js
 * @description Manages preset states, configuration loading/saving, LocalStorage persistence,
 * and automatic schema migrations for the Gesture Synth application.
 */

import defaultPresetData from "../presets.json";

/** @type {Object|null} Complete preset state object containing activePresetId and array of presets */
let presetState = null;

/** @type {Object|null} Currently active preset configuration object */
let currentConfig = null;

/**
 * Loads the preset state from browser localStorage if available.
 * Falls back to default presets from presets.json if local storage is missing or invalid.
 * Also performs automatic migration for legacy presets (ensuring degree gestures 6/7
 * and right hand tilt/height minVal/maxVal fields are defined).
 */
export function loadPresetState() {
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

  // Identify active preset based on activePresetId
  const activeId = presetState.activePresetId || presetState.presets[0].id;
  currentConfig = presetState.presets.find((p) => p.id === activeId) || presetState.presets[0];

  // Auto-migrate gestures 6 and 7, and ensure tilt/height minVal/maxVal fields exist across all presets
  presetState.presets.forEach((p) => {
    if (p.leftHand && p.leftHand.gestures) {
      if (!p.leftHand.gestures["6"]) {
        p.leftHand.gestures["6"] = p.leftHand.gestures["VI"] || {
          type: "note",
          note: 69,
          velocity: 100,
          label: "Degree VI / A4",
        };
      }
      if (!p.leftHand.gestures["7"]) {
        p.leftHand.gestures["7"] = p.leftHand.gestures["VII"] || {
          type: "note",
          note: 71,
          velocity: 100,
          label: "Degree VII / B4",
        };
      }
    }
    if (p.rightHand) {
      if (p.rightHand.tilt) {
        if (p.rightHand.tilt.minVal === undefined) p.rightHand.tilt.minVal = 0;
        if (p.rightHand.tilt.maxVal === undefined) p.rightHand.tilt.maxVal = 127;
      }
      if (p.rightHand.height) {
        if (p.rightHand.height.minVal === undefined) p.rightHand.height.minVal = 0;
        if (p.rightHand.height.maxVal === undefined) p.rightHand.height.maxVal = 127;
      }
    }
  });
}

/**
 * Saves the current preset state object to browser localStorage.
 */
export function savePresetState() {
  localStorage.setItem("gesture_synth_config", JSON.stringify(presetState));
}

/**
 * Returns the global preset state object.
 * @returns {Object} The active preset state containing all presets.
 */
export function getPresetState() {
  if (!presetState) loadPresetState();
  return presetState;
}

/**
 * Updates the global preset state object.
 * @param {Object} newState The new preset state object.
 */
export function setPresetState(newState) {
  presetState = newState;
}

/**
 * Returns the currently active preset configuration object.
 * @returns {Object} The current preset configuration.
 */
export function getCurrentConfig() {
  if (!currentConfig) loadPresetState();
  return currentConfig;
}

/**
 * Updates the currently active preset configuration object.
 * @param {Object} newConfig The new active preset configuration.
 */
export function setCurrentConfig(newConfig) {
  currentConfig = newConfig;
}

// Initial load on module evaluation
loadPresetState();
