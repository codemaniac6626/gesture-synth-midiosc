// midi.js - Web MIDI API Handler for Gesture Synth

export class MidiEngine {
  constructor() {
    this.midiAccess = null;
    this.outputs = new Map(); // id -> MIDIOutput
    this.selectedOutputId = "all"; // "all" or specific output ID
    this.channel = 1; // 1-16
    this.isSupported = false;
    this.isEnabled = true;
    this.activeNotes = new Set(); // Set of currently active MIDI note numbers
    this.lastCCValues = new Map(); // ccNumber -> lastValue
    this.onStateChangeCallbacks = [];
    this.onActivityCallbacks = [];
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      console.warn("Web MIDI API is not supported in this browser.");
      this.isSupported = false;
      this.notifyStateChange();
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.isSupported = true;
      this.refreshOutputs();

      this.midiAccess.onstatechange = (e) => {
        console.log("MIDI device state changed:", e.port.name, e.port.state);
        this.refreshOutputs();
        this.notifyStateChange();
      };

      this.notifyStateChange();
      return true;
    } catch (err) {
      console.error("Failed to access Web MIDI API:", err);
      this.isSupported = false;
      this.notifyStateChange();
      return false;
    }
  }

  refreshOutputs() {
    if (!this.midiAccess) return;
    this.outputs.clear();
    for (let output of this.midiAccess.outputs.values()) {
      this.outputs.set(output.id, output);
    }
  }

  getOutputList() {
    const list = [{ id: "all", name: "All Available Outputs" }];
    for (let [id, output] of this.outputs.entries()) {
      list.push({ id, name: output.name || `MIDI Output ${id}` });
    }
    return list;
  }

  setChannel(channelNum) {
    this.channel = Math.max(1, Math.min(16, parseInt(channelNum, 10) || 1));
  }

  setOutput(outputId) {
    this.selectedOutputId = outputId;
  }

  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
    if (!this.isEnabled) {
      this.allNotesOff();
    }
  }

  onStateChange(callback) {
    this.onStateChangeCallbacks.push(callback);
  }

  onActivity(callback) {
    this.onActivityCallbacks.push(callback);
  }

  notifyStateChange() {
    const status = {
      isSupported: this.isSupported,
      outputCount: this.outputs.size,
      outputs: this.getOutputList(),
      selectedOutputId: this.selectedOutputId,
      isEnabled: this.isEnabled
    };
    this.onStateChangeCallbacks.forEach(cb => cb(status));
  }

  notifyActivity(type, detail) {
    this.onActivityCallbacks.forEach(cb => cb({ type, detail }));
  }

  getTargetOutputs() {
    if (!this.isSupported || !this.isEnabled) return [];
    if (this.selectedOutputId === "all") {
      return Array.from(this.outputs.values());
    }
    const output = this.outputs.get(this.selectedOutputId);
    return output ? [output] : Array.from(this.outputs.values());
  }

  // ---- Send MIDI Note On ----
  sendNoteOn(noteNumber, velocity = 100) {
    if (!this.isEnabled || !this.isSupported) return;
    const note = Math.max(0, Math.min(127, Math.round(noteNumber)));
    const vel = Math.max(1, Math.min(127, Math.round(velocity)));
    const channelByte = 0x90 | ((this.channel - 1) & 0x0f);

    const targetOutputs = this.getTargetOutputs();
    targetOutputs.forEach(output => {
      try {
        output.send([channelByte, note, vel]);
      } catch (err) {
        console.error("MIDI send Note On error:", err);
      }
    });

    this.activeNotes.add(note);
    this.notifyActivity("noteOn", { note, velocity: vel });
  }

  // ---- Send MIDI Note Off ----
  sendNoteOff(noteNumber) {
    if (!this.isSupported) return;
    const note = Math.max(0, Math.min(127, Math.round(noteNumber)));
    const channelByte = 0x80 | ((this.channel - 1) & 0x0f);

    const targetOutputs = this.getTargetOutputs();
    targetOutputs.forEach(output => {
      try {
        output.send([channelByte, note, 0]);
      } catch (err) {
        console.error("MIDI send Note Off error:", err);
      }
    });

    this.activeNotes.delete(note);
    this.notifyActivity("noteOff", { note });
  }

  // ---- Play a set of notes (and release old ones) ----
  playNotes(noteNumbers, velocity = 100) {
    if (!this.isEnabled || !this.isSupported) return;

    const newNoteSet = new Set(noteNumbers.map(n => Math.max(0, Math.min(127, Math.round(n)))));

    // Send Note Off for notes no longer in the set
    for (let activeNote of Array.from(this.activeNotes)) {
      if (!newNoteSet.has(activeNote)) {
        this.sendNoteOff(activeNote);
      }
    }

    // Send Note On for new notes
    for (let note of Array.from(newNoteSet)) {
      if (!this.activeNotes.has(note)) {
        this.sendNoteOn(note, velocity);
      }
    }
  }

  // ---- Send MIDI Control Change (CC) ----
  sendCC(ccNumber, value) {
    if (!this.isEnabled || !this.isSupported) return;
    const cc = Math.max(0, Math.min(127, Math.round(ccNumber)));
    const val = Math.max(0, Math.min(127, Math.round(value)));

    // Avoid redundant duplicate sends for unchanged CC
    if (this.lastCCValues.get(cc) === val) return;
    this.lastCCValues.set(cc, val);

    const channelByte = 0xB0 | ((this.channel - 1) & 0x0f);
    const targetOutputs = this.getTargetOutputs();

    targetOutputs.forEach(output => {
      try {
        output.send([channelByte, cc, val]);
      } catch (err) {
        console.error("MIDI send CC error:", err);
      }
    });

    this.notifyActivity("cc", { cc, value: val });
  }

  // ---- Silence all active notes ----
  allNotesOff() {
    for (let activeNote of Array.from(this.activeNotes)) {
      this.sendNoteOff(activeNote);
    }
    this.activeNotes.clear();
  }
}
