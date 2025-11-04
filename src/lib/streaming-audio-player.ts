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

    return new Promise<AudioBuffer>((resolve, reject) => {
      context.decodeAudioData(
        audioBuffer.slice(0),
        decoded => resolve(decoded),
        error =>
          reject(
            error instanceof Error
              ? error
              : new Error(String(error)),
          ),
      );
    });
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

      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        source.onended = null;
        try {
          source.disconnect();
        } catch {
          // ignore disconnect errors
        }
        if (signal) {
          signal.removeEventListener('abort', handleAbort);
        }
        this.activeSources.delete(source);
        resolve();
      };

      const handleAbort = () => {
        try {
          source.stop();
        } catch {
          // ignore stop errors
        }
        cleanup();
      };

      if (signal) {
        signal.addEventListener('abort', handleAbort, { once: true });
      }

      source.onended = cleanup;

      const now = context.currentTime;
      const startAt = Math.max(this.queueTime, now) + 0.01;
      this.queueTime = startAt + audioBuffer.duration;
      this.activeSources.add(source);

      try {
        source.start(startAt);
      } catch (error) {
        if (settled) return;
        settled = true;
        if (signal) {
          signal.removeEventListener('abort', handleAbort);
        }
        this.activeSources.delete(source);
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
