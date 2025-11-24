import { MODELS } from '@/lib/models';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';
const DEEPGRAM_MODEL = MODELS.TRANSCRIPTION;

/**
 * Transcribe an audio blob using Deepgram's REST API.
 * @param audioBlob Blob containing recorded audio data.
 * @returns Transcript text extracted from Deepgram response.
 */
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('Empty audio provided for transcription.');
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error('Deepgram API key not configured. Set DEEPGRAM_API_KEY.');
  }

  const searchParams = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    punctuate: 'true',
    language: 'en-US',
  });

  const requestUrl = `${DEEPGRAM_API_URL}?${searchParams.toString()}`;

  try {
    const arrayBuffer = await audioBlob.arrayBuffer();

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': audioBlob.type || 'application/octet-stream',
      },
      body: Buffer.from(arrayBuffer),
    });

    if (!response.ok) {
      const errorBody = await safeJson(response);
      const message =
        (typeof errorBody?.error === 'string' ? errorBody.error : undefined) ??
        (typeof errorBody?.message === 'string' ? errorBody.message : undefined);
      throw new Error(
        `Deepgram transcription failed (status ${response.status})${message ? `: ${message}` : ''}`,
      );
    }

    const data = await response.json();
    const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

    if (!transcript) {
      throw new Error('Deepgram response did not include a transcript.');
    }

    return transcript;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Deepgram transcription error: ${error.message}`);
    }
    throw new Error('Unknown error during Deepgram transcription.');
  }
}

type ErrorBody = {
  error?: unknown;
  message?: unknown;
};

async function safeJson(response: Response): Promise<ErrorBody | null> {
  try {
    return (await response.json()) as ErrorBody;
  } catch {
    return null;
  }
}
