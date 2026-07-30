/**
 * @file musicTheory.js
 * @description Provides music theory constants, frequency calculations, MIDI note conversion helpers,
 * scale degree mappings, and chord tone frequency generators for harmonized polyphony.
 */

/** Semitone offset relative to scale tonic for degrees 1 through 7 */
export const DEGREE_SEMITONES = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };

/** Map Roman numeral strings and numeric characters to degree numbers */
export const NUMERAL_TO_DEGREE = { 
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7,
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7
};

/** Major scale note names per musical key */
export const MAJOR_SCALE = {
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

/**
 * Converts a frequency in Hertz to the closest integer MIDI note number (A4 = 440Hz -> 69).
 *
 * @param {number} freq Frequency in Hertz.
 * @returns {number} Integer MIDI note number (0 to 127).
 */
export function freqToMidiNote(freq) {
  if (!freq || freq <= 0) return 60;
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

/**
 * Converts a MIDI note number to human-readable note name (e.g. 60 -> "C4").
 *
 * @param {number} noteNum Integer MIDI note number.
 * @returns {string} Formatted note string.
 */
export function midiNoteToName(noteNum) {
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(noteNum / 12) - 1;
  const name = notes[noteNum % 12];
  return `${name}${octave}`;
}

/**
 * Calculates fundamental frequency (in Hz) for a specific scale degree based on active tonic frequency.
 *
 * @param {number} degree Scale degree (1 to 7).
 * @param {number} tonicFreq Base key tonic frequency in Hz.
 * @returns {number} Calculated frequency in Hz.
 */
export function getDegreeFreq(degree, tonicFreq) {
  const semitones = DEGREE_SEMITONES[degree] ?? 0;
  let tonic = tonicFreq;
  if (tonic === 369.99 || tonic === 392.00 || tonic === 415.30) {
    tonic /= 2;
  }
  return tonic * Math.pow(2, semitones / 12);
}

/**
 * Generates display chord label (e.g., "C", "Am") based on Roman numeral and active key.
 *
 * @param {string} roman Roman numeral chord identifier.
 * @param {boolean} isMajorMode True if major mode, false if minor mode.
 * @param {string} keyName Name of current key (e.g. "A", "C").
 * @returns {string} Formatted root note chord string.
 */
export function getChordName(roman, isMajorMode, keyName) {
  if (!roman || roman === "--") return "";
  const degree = NUMERAL_TO_DEGREE[roman.toUpperCase()];
  if (!degree) return "";
  const root = MAJOR_SCALE[keyName]?.[degree - 1];
  if (!root) return "";
  return isMajorMode ? root : root + "m";
}

/**
 * Calculates constituent harmonic frequencies (root, third, fifth, octave, 7ths) for a chord.
 *
 * @param {string} numeralStr Roman numeral string.
 * @param {boolean} isMajorMode True if major scale, false if minor scale.
 * @param {number} tonicFreq Base key tonic frequency in Hz.
 * @returns {Object|null} Object containing chord harmonic component frequencies in Hz.
 */
export function getChordTones(numeralStr, isMajorMode, tonicFreq) {
  if (!numeralStr || numeralStr === "--") return null;
  const degree = NUMERAL_TO_DEGREE[numeralStr.toUpperCase()];
  if (!degree) return null;

  const root = getDegreeFreq(degree, tonicFreq);
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

/**
 * Maps chord tones to specific voicing frequencies depending on right hand finger count trigger.
 *
 * @param {Object} tones Chord tone frequencies object from getChordTones().
 * @param {number} rightHandCount Right hand active finger count (1 to 4).
 * @param {boolean} isMajorMode Mode selection.
 * @returns {Array<number>} Array of frequencies to trigger in synth/MIDI.
 */
export function getSolidNotes(tones, rightHandCount, isMajorMode) {
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
