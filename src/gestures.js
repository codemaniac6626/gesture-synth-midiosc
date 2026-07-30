/**
 * @file gestures.js
 * @description Analyzes MediaPipe hand landmark coordinates to classify finger extension status,
 * chord Roman numerals, horizontal tilt angles, vertical hand height volume, and finger trigger counts.
 */

/**
 * Mapping of finger names to MediaPipe landmark joint indices (PIP and TIP).
 */
export const FINGERS = {
  index:  { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring:   { pip: 14, tip: 16 },
  pinky:  { pip: 18, tip: 20 },
};

/**
 * Checks whether a specific finger is extended based on y-coordinate positioning.
 *
 * @param {Array<Object>} landmarks MediaPipe 2D hand landmark array.
 * @param {"index"|"middle"|"ring"|"pinky"} name Finger identifier.
 * @returns {boolean} True if the tip landmark is higher on screen (smaller y) than the PIP joint.
 */
export function isFingerExtended(landmarks, name) {
  const { pip, tip } = FINGERS[name];
  return landmarks[tip].y < landmarks[pip].y;
}

/**
 * Checks whether the thumb is extended horizontally, accounting for left/right hand orientation.
 *
 * @param {Array<Object>} landmarks MediaPipe 2D hand landmark array.
 * @param {"Left"|"Right"} handedness Hand classification.
 * @returns {boolean} True if thumb tip is extended outward.
 */
export function isThumbExtended(landmarks, handedness) {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  return handedness === "Right" ? (thumbTip.x > thumbIp.x) : (thumbTip.x < thumbIp.x);
}

/**
 * Determines chord quality ("major" or "minor") based on hand palm orientation / wrist to middle MCP alignment.
 *
 * @param {Array<Object>} landmarks MediaPipe 2D hand landmark array.
 * @returns {"major"|"minor"} Evaluated chord quality.
 */
export function getChordQuality(landmarks) {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  return middleMcp.x > wrist.x ? "minor" : "major";
}

/**
 * Classifies the active hand gesture into a scale degree Roman numeral (I..VII or i..vii).
 *
 * @param {Array<Object>} landmarks MediaPipe 2D hand landmark array.
 * @param {"Left"|"Right"} handedness Hand classification.
 * @returns {string|null} Roman numeral string (e.g. "I", "IV", "vi") or null if no valid gesture.
 */
export function classifyChord(landmarks, handedness) {
  const thumb = isThumbExtended(landmarks, handedness);
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");

  const quality = getChordQuality(landmarks);

  // Gesture 6: Index + Pinky (No Middle, No Ring, No Thumb)
  if (index && pinky && !middle && !ring && !thumb) {
    return quality === "major" ? "VI" : "vi";
  }

  // Gesture 7: Index + Pinky + Thumb (No Middle, No Ring)
  if (index && pinky && !middle && !ring && thumb) {
    return quality === "major" ? "VII" : "vii";
  }

  // Count total extended fingers for degrees 1..5
  const count = [thumb, index, middle, ring, pinky].filter(Boolean).length;
  const ROMAN = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };
  const base = ROMAN[count];
  if (!base) return null;

  return quality === "major" ? base : base.toLowerCase();
}

/**
 * Calculates horizontal hand tilt factor between -1.0 and +1.0 based on wrist and MCP positions.
 *
 * @param {Array<Object>} landmarks MediaPipe 2D hand landmark array.
 * @param {"Left"|"Right"} handedness Hand classification.
 * @returns {number} Tilt factor normalized between -1.0 and +1.0.
 */
export function getHandHorizontalTilt(landmarks, handedness) {
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

/**
 * Calculates volume factor from vertical wrist height (0.0 at bottom to 1.0 at top),
 * scaled by minVal and maxVal configuration if provided (normalizing values to 0.0..1.0).
 *
 * @param {Array<Object>} landmarks MediaPipe 2D hand landmark array.
 * @param {Object} [heightConfig] Height config containing minVal/maxVal or minVelocity/maxVelocity.
 * @returns {number} Volume level normalized from 0.0 to 1.0.
 */
export function getVolumeFromHeight(landmarks, heightConfig = null) {
  const wrist = landmarks[0];
  const TOP = 0.05;
  const BOTTOM = 0.95;
  const clamped = Math.max(TOP, Math.min(BOTTOM, wrist.y));
  const t = (clamped - TOP) / (BOTTOM - TOP);
  const rawVol = 1 - t;

  if (!heightConfig) return rawVol;

  const minVal = heightConfig.minVal ?? heightConfig.minVelocity ?? 0;
  const maxVal = heightConfig.maxVal ?? heightConfig.maxVelocity ?? 127;

  const minNorm = minVal / 127;
  const maxNorm = maxVal / 127;

  return minNorm + rawVol * (maxNorm - minNorm);
}

/**
 * Counts extended non-thumb fingers on the right hand to determine voicing / CC trigger index (1..4).
 *
 * @param {Array<Object>} landmarks MediaPipe 2D hand landmark array.
 * @returns {number} Extended non-thumb finger count (0 to 4).
 */
export function getRightHandQualityIndex(landmarks) {
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");
  return [index, middle, ring, pinky].filter(Boolean).length;
}
