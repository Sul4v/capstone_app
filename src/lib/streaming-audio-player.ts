class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;

  private queueTime = 0;

  private activeSources = new Set<AudioBufferSourceNode>();

  private getContext(): AudioContext {
    if (this.audioContext) {
      return this.audioContext;
    }

    const AudioCtx =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          // @ts-expect-error Safari prefix
          window.webkitAudioContext)
        : null;

    if (!AudioCtx) {
      throw new Error('Web Audio API is not supported in this browser.');
    }

    this.audioContext = new AudioCtx();
    this.queueTime = this.audioContext.currentTime;
    return this.audioContext;
  }

  private async decode(base64Audio: string): Promise<AudioBuffer> {
    const context = this.getContext();
    if (context.state === 'suspended') {
      await context.resume();
    }

    const audioBuffer = StreamingAudioPlayer.base64ToArrayBuffer(base64Audio);

    // Assume PCM 16-bit, 16kHz, mono (from ElevenLabs pcm_16000)
    const int16Data = new Int16Array(audioBuffer);
    const float32Data = new Float32Array(int16Data.length);

    for (let i = 0; i < int16Data.length; i++) {
      // Normalize 16-bit integer to -1.0 to 1.0 float
      float32Data[i] = int16Data[i] / 32768.0;
    }

    const buffer = context.createBuffer(1, float32Data.length, 16000);
    buffer.getChannelData(0).set(float32Data);

    return buffer;
  }

  async enqueue(
    audioBase64: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      return;
    }

    const context = this.getContext();
    const audioBuffer = await this.decode(audioBase64);

    if (signal?.aborted) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(context.destination);

      const cleanup = () => {
        source.onended = null;
        try {
          source.disconnect();
        } catch {
          // ignore disconnect errors
        }
        this.activeSources.delete(source);
      };

      source.onended = cleanup;

      // Only handle abort for the setup phase
      if (signal?.aborted) {
        cleanup();
        resolve();
        return;
      }

      const now = context.currentTime;
      // Small lookahead to prevent glitching if we are late
      const startAt = Math.max(this.queueTime, now + 0.05);
      this.queueTime = startAt + audioBuffer.duration;
      this.activeSources.add(source);

      try {
        source.start(startAt);
        resolve(); // Resolve immediately after scheduling
      } catch (error) {
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error(String(error)),
        );
      }
    });
  }

  stop(): void {
    const context = this.audioContext;
    this.queueTime = context?.currentTime ?? 0;

    this.activeSources.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // ignore stop/disconnect errors
      }
    });

    this.activeSources.clear();
  }

  dispose(): void {
    this.stop();
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {
        // ignore close errors
      });
      this.audioContext = null;
    }
    this.queueTime = 0;
  }

  private static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const normalized = base64.replace(/[\n\r]/g, '');
    const byteString = atob(normalized);
    const len = byteString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = byteString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export { StreamingAudioPlayer };
