const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';

type ElevenLabsError = {
  detail?: Array<{ message?: string }> | string;
  error?: string;
  message?: string;
};

/**
 * Generate speech audio using ElevenLabs.
 * @param text Text to synthesize.
 * @param voiceId ElevenLabs voice identifier.
 * @returns Audio buffer containing the synthesized speech.
 */
export async function generateSpeech(text: string, voiceId: string): Promise<Buffer> {
  if (!text?.trim()) {
    throw new Error('Text is required to generate speech.');
  }

  if (!voiceId) {
    throw new Error('Voice ID is required to generate speech.');
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY.');
  }

  const url = `${ELEVENLABS_BASE_URL}/${voiceId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    console.error('ElevenLabs TTS HTTP status:', response.status);
    const errorBody = await safeJson(response);
    if (!errorBody) {
      const fallbackText = await response.text();
      console.error('ElevenLabs TTS request failed with non-JSON body:', fallbackText);
    } else {
      console.error('ElevenLabs TTS request failed:', JSON.stringify(errorBody));
    }
    const detailMessage =
      (Array.isArray(errorBody?.detail) && errorBody.detail.length > 0 && errorBody.detail[0]?.message) ||
      (typeof errorBody?.detail === 'string' ? errorBody.detail : undefined) ||
      (typeof errorBody?.detail === 'object' &&
        errorBody.detail !== null &&
        'message' in (errorBody.detail as unknown as Record<string, unknown>) &&
        typeof (errorBody.detail as { message?: unknown }).message === 'string'
        ? (errorBody.detail as unknown as { message: string }).message
        : undefined);
    const message =
      detailMessage ||
      (typeof errorBody?.error === 'string' ? errorBody.error : undefined) ||
      (typeof errorBody?.message === 'string' ? errorBody.message : undefined) ||
      `HTTP ${response.status}`;
    throw new Error(`ElevenLabs TTS request failed: ${message}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function safeJson(response: Response): Promise<ElevenLabsError | null> {
  try {
    return (await response.json()) as ElevenLabsError;
  } catch {
    return null;
  }
}
