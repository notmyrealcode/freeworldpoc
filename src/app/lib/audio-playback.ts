export class AudioPlayback {
  private audioContext: AudioContext;
  private nextStartTime: number = 0;
  private _isPlaying: boolean = false;
  private activeSources: AudioBufferSourceNode[] = [];
  private onPlayingChange: ((playing: boolean) => void) | null = null;

  constructor(onPlayingChange?: (playing: boolean) => void) {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    this.onPlayingChange = onPlayingChange ?? null;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  private setPlaying(value: boolean): void {
    if (this._isPlaying !== value) {
      this._isPlaying = value;
      this.onPlayingChange?.(value);
    }
  }

  play(base64Pcm: string): void {
    const pcmBytes = atob(base64Pcm);
    const pcmArray = new Int16Array(pcmBytes.length / 2);
    for (let i = 0; i < pcmBytes.length; i += 2) {
      pcmArray[i / 2] =
        pcmBytes.charCodeAt(i) | (pcmBytes.charCodeAt(i + 1) << 8);
    }

    // Convert int16 to float32 for Web Audio
    const float32 = new Float32Array(pcmArray.length);
    for (let i = 0; i < pcmArray.length; i++) {
      float32[i] = pcmArray[i] / 32768;
    }

    const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;

    this.activeSources.push(source);
    this.setPlaying(true);

    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
      if (this.activeSources.length === 0) {
        this.setPlaying(false);
      }
    };
  }

  interrupt(): void {
    // Stop all active sources without recreating the AudioContext
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    }
    this.activeSources = [];
    this.nextStartTime = 0;
    this.setPlaying(false);
  }

  async resume(): Promise<void> {
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  close(): void {
    this.interrupt();
    this.audioContext.close();
  }
}
