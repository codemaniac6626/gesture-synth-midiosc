/**
 * @file stabilizer.js
 * @description Provides hysteresis and temporal state debouncing for hand gesture recognition.
 * Prevents rapid flickering or unintentional note-offs when computer vision detection drops frames temporarily.
 */

/** Minimum duration (in ms) a chord gesture must remain steady before locking in */
export const CHORD_HOLD_TIME_MS = 100;

/** Tolerance window (in ms) to hold previous chord when MediaPipe briefly loses landmark tracking */
export const VIBE_NULL_WINDOW_MS = 50;

/** @type {Object|null} Last stabilized chord state */
let stableChordState = null;

/** @type {Object|null} Pending candidate chord state */
let candidateChordState = null;

/** @type {number} Timestamp when candidate chord state was first detected */
let candidateChordSince = 0;

/** @type {number} Timestamp when valid chord gesture was last observed */
let lastChordSeenValidTime = 0;

/**
 * Compares two chord state objects for equivalence.
 *
 * @param {Object|null} a First chord state object.
 * @param {Object|null} b Second chord state object.
 * @returns {boolean} True if both states represent the same chord, quality, and mode.
 */
export function sameChordState(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.chord === b.chord &&
    a.isMajorMode === b.isMajorMode &&
    a.qualityIndex === b.qualityIndex &&
    a.thumbDown === b.thumbDown
  );
}

/**
 * Stabilizes raw frame-by-frame chord detection using temporal debouncing.
 *
 * @param {Object|null} rawState Instantaneous detected chord state from current video frame.
 * @param {number} now Current performance.now() timestamp.
 * @returns {Object|null} Debounced, stable chord state.
 */
export function stabilizeChordState(rawState, now) {
  if (rawState !== null) lastChordSeenValidTime = now;
  let effectiveState = rawState;

  // Hold previous candidate state if frame drop occurred within null window
  if (rawState === null && now - lastChordSeenValidTime < VIBE_NULL_WINDOW_MS) {
    effectiveState = candidateChordState;
  }

  // Reset timer if raw detection changes
  if (!sameChordState(effectiveState, candidateChordState)) {
    candidateChordState = effectiveState;
    candidateChordSince = now;
  }

  // Lock in state once held steady for CHORD_HOLD_TIME_MS
  if (now - candidateChordSince >= CHORD_HOLD_TIME_MS) {
    stableChordState = candidateChordState;
  }

  return stableChordState;
}
