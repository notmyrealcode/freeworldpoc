class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._targetSampleRate = 16000;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono
    const ratio = sampleRate / this._targetSampleRate;

    // Downsample by picking samples at the target rate interval
    for (let i = 0; i < channelData.length; i += ratio) {
      const index = Math.floor(i);
      if (index < channelData.length) {
        // Convert float32 [-1,1] to int16
        const s = Math.max(-1, Math.min(1, channelData[index]));
        this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    }

    // Send chunks of 1600 samples (100ms at 16kHz)
    while (this._buffer.length >= 1600) {
      const chunk = this._buffer.splice(0, 1600);
      const pcm16 = new Int16Array(chunk);
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
