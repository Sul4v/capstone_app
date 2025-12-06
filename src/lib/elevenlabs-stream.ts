import WebSocket from 'ws';

type VoiceSettings = {
  stability?: number;
  similarity_boost?: number;
  use_speaker_boost?: boolean;
  style?: number;
  speed?: number;
};

type GenerationConfig = {
  chunk_length_schedule?: number[];
};

export type ElevenLabsRealtimeOptions = {
  voiceId: string;
  modelId?: string;
  voiceSettings?: VoiceSettings;
  generationConfig?: GenerationConfig;
};

type ElevenLabsStreamHandlers = {
  onAudio: (audioBase64: string) => void;
  onFinal?: () => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
};

export type ElevenLabsRealtimeStream = {
  sendText: (text: string, options?: { flush?: boolean }) => void;
  end: () => void;
  close: () => void;
};

export async function createElevenLabsRealtimeStream(
  options: ElevenLabsRealtimeOptions,
  handlers: ElevenLabsStreamHandlers,
): Promise<ElevenLabsRealtimeStream> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY.');
  }

  const modelId = options.modelId ?? 'eleven_flash_v2_5';
  const voiceId = options.voiceId;
  if (!voiceId) {
    throw new Error('Voice ID required for ElevenLabs realtime stream.');
  }

  // Small delay to help avoid rate limiting on rapid successive calls
  await new Promise(resolve => setTimeout(resolve, 100));

  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${modelId}&output_format=pcm_16000`;

  const ws = new WebSocket(url, {
    headers: {
      'xi-api-key': apiKey,
    },
  });

  let isOpen = false;
  let isClosed = false;
  let keepAliveInterval: NodeJS.Timeout | null = null;

  const clearKeepAlive = () => {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  };

  const readyPromise = new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      isOpen = true;
      const initPayload: Record<string, unknown> = {
        text: ' ',
      };

      if (options.voiceSettings) {
        initPayload.voice_settings = options.voiceSettings;
      }

      if (options.generationConfig) {
        initPayload.generation_config = options.generationConfig;
      }

      ws.send(JSON.stringify(initPayload));
      resolve();

      keepAliveInterval = setInterval(() => {
        if (!isOpen || isClosed) {
          clearKeepAlive();
          return;
        }
        try {
          ws.send(JSON.stringify({ text: ' ' }));
        } catch (error) {
          clearKeepAlive();
          const wrapped =
            error instanceof Error
              ? error
              : new Error(`ElevenLabs websocket keepalive error: ${String(error)}`);
          handlers.onError?.(wrapped);
        }
      }, 5000);
    });

    ws.on('error', err => {
      const wrapped =
        err instanceof Error ? err : new Error(`ElevenLabs websocket error: ${String(err)}`);
      if (!isOpen) {
        reject(wrapped);
      } else if (handlers.onError) {
        handlers.onError(wrapped);
      }
    });
  });

  ws.on('message', data => {
    try {
      const payload = JSON.parse(data.toString('utf-8')) as {
        audio?: string;
        isFinal?: boolean;
        error?: string;
      };

      if (payload.error) {
        handlers.onError?.(new Error(payload.error));
      }

      if (payload.audio) {
        handlers.onAudio(payload.audio);
      }

      if (payload.isFinal) {
        handlers.onFinal?.();
      }
    } catch (error) {
      handlers.onError?.(
        error instanceof Error
          ? error
          : new Error(`Failed to parse ElevenLabs message: ${String(error)}`),
      );
    }
  });

  ws.on('close', () => {
    isClosed = true;
    clearKeepAlive();
    handlers.onClose?.();
  });

  await readyPromise;

  const sendText = (text: string, sendOptions?: { flush?: boolean }) => {
    if (!isOpen || isClosed) return;
    const payload: Record<string, unknown> = {
      text,
    };
    if (sendOptions?.flush) {
      payload.flush = true;
    }
    ws.send(JSON.stringify(payload));
  };

  const end = () => {
    if (!isOpen || isClosed) return;
    clearKeepAlive();
    ws.send(JSON.stringify({ text: '', flush: true }));
  };

  const close = () => {
    if (isClosed) return;
    clearKeepAlive();
    try {
      ws.close();
    } catch {
      // ignore close errors
    }
  };

  return {
    sendText,
    end,
    close,
  };
}
