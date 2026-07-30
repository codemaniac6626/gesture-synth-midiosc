/**
 * @file synthEngine.js
 * @description Web Audio API synthesis engine handling AudioContext initialization, multi-oscillator polyphony,
 * dynamic biquad lowpass filter sweeps driven by tilt gestures, waveshaper curves, and master volume gain control.
 */

export class SynthEngine {
  constructor() {
    /** @type {AudioContext|null} Web Audio context instance */
    this.ctx = null;
    /** @type {BiquadFilterNode|null} Lowpass biquad filter for tilt gesture sweeps */
    this.filter = null;
    /** @type {WaveShaperNode|null} WaveShaper node for harmonic overtones */
    this.waveShaper = null;
    /** @type {GainNode|null} Master gain output node */
    this.masterGain = null;
    /** @type {Array<OscillatorNode>} Active oscillator nodes */
    this.oscillators = [];
    /** @type {string|null} String key representing currently playing frequency set */
    this.currentKey = null;
  }

  /**
   * Initializes Web Audio AudioContext and connects audio graph nodes if not already created.
   */
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

  /**
   * Smoothly updates master gain with setTargetAtTime.
   *
   * @param {number} volume01 Normalized height volume level (0.0 to 1.0).
   * @param {Object} currentConfig Active preset configuration.
   */
  updateVolume(volume01, currentConfig) {
    if (!this.ctx) return;
    const targetGain = currentConfig?.audioEnabled ? (volume01 * (currentConfig.masterVolume ?? 0.8)) : 0;
    this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.03);
  }

  /**
   * Ramp master gain linearly to target volume.
   *
   * @param {number} volume01 Normalized height volume level (0.0 to 1.0).
   * @param {Object} currentConfig Active preset configuration.
   */
  setVolume(volume01, currentConfig) {
    if (!this.ctx) return;
    const targetGain = currentConfig?.audioEnabled ? (volume01 * (currentConfig.masterVolume ?? 0.8)) : 0;
    const clamped = Math.max(0, Math.min(1, targetGain));
    this.masterGain.gain.linearRampToValueAtTime(clamped, this.ctx.currentTime + 0.05);
  }

  /**
   * Updates biquad filter frequency and resonance Q according to horizontal tilt factor.
   *
   * @param {number} tiltFactor Horizontal hand tilt factor (-1.0 to +1.0).
   */
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

  /**
   * Triggers polyphonic audio synthesis for specified frequency array.
   *
   * @param {Array<number>} freqs Frequencies in Hz to play.
   * @param {Object} currentConfig Active preset configuration.
   * @param {OscillatorType} currentWaveform Waveform shape ("triangle", "sawtooth", "square").
   */
  playNotes(freqs, currentConfig, currentWaveform = "triangle") {
    if (!this.ctx || !currentConfig?.audioEnabled || freqs.length === 0) return;
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

  /**
   * Stops all active audio synthesis and silences master output.
   */
  stop() {
    if (this.ctx) {
      this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    this.oscillators.forEach((osc) => { try { osc.stop(); } catch {} });
    this.oscillators = [];
    this.currentKey = null;
  }
}

/** Default singleton instance of SynthEngine */
export const synth = new SynthEngine();
