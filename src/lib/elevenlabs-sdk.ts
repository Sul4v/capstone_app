/**
 * ElevenLabs SDK Integration
 * 
 * Uses the official @elevenlabs/elevenlabs-js SDK for text-to-speech.
 * This provides built-in retry logic, proper error handling, and
 * better compatibility with ElevenLabs' API requirements.
 * 
 * Reference: https://github.com/elevenlabs/elevenlabs-js
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

// Singleton client instance
let client: ElevenLabsClient | null = null;

function getClient(): ElevenLabsClient {
    if (!client) {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY.');
        }
        client = new ElevenLabsClient({ apiKey });
    }
    return client;
}

export type TTSOptions = {
    voiceId: string;
    text: string;
    modelId?: string;
    voiceSettings?: {
        stability?: number;
        similarityBoost?: number;
        style?: number;
        useSpeakerBoost?: boolean;
    };
};

/**
 * Helper to consume an async iterable or ReadableStream
 */
async function* iterateStream(
    stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>
): AsyncGenerator<Uint8Array> {
    // Check if it's an async iterable
    if (Symbol.asyncIterator in stream) {
        const iterable = stream as AsyncIterable<Uint8Array>;
        for await (const chunk of iterable) {
            yield chunk;
        }
        return;
    }

    // Otherwise treat as ReadableStream
    const readable = stream as ReadableStream<Uint8Array>;
    const reader = readable.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) yield value;
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Convert text to speech and return the audio stream.
 * Uses HTTP streaming which is more reliable than WebSocket for
 * cases where the full text is available.
 */
export async function textToSpeechStream(options: TTSOptions): Promise<ReadableStream<Uint8Array>> {
    const elevenlabs = getClient();

    const modelId = options.modelId ?? 'eleven_flash_v2_5';

    // The SDK's stream method returns audio data
    const audioData = await elevenlabs.textToSpeech.stream(options.voiceId, {
        text: options.text,
        modelId: modelId,
        outputFormat: 'pcm_16000',
        voiceSettings: options.voiceSettings ? {
            stability: options.voiceSettings.stability,
            similarityBoost: options.voiceSettings.similarityBoost,
            style: options.voiceSettings.style,
            useSpeakerBoost: options.voiceSettings.useSpeakerBoost,
        } : undefined,
    });

    // Create an async generator from the audio data
    const generator = iterateStream(audioData);

    // Convert to ReadableStream
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await generator.next();
                if (done) {
                    controller.close();
                    return;
                }
                if (value instanceof Buffer) {
                    controller.enqueue(new Uint8Array(value));
                } else if (value instanceof Uint8Array) {
                    controller.enqueue(value);
                }
            } catch (error) {
                controller.error(error);
            }
        }
    });
}

/**
 * Convert text to speech and return as a Buffer.
 * Useful when you need the complete audio at once.
 */
export async function textToSpeechBuffer(options: TTSOptions): Promise<Buffer> {
    const elevenlabs = getClient();

    const modelId = options.modelId ?? 'eleven_flash_v2_5';

    // The convert method returns audio data
    const audioData = await elevenlabs.textToSpeech.convert(options.voiceId, {
        text: options.text,
        modelId: modelId,
        outputFormat: 'pcm_16000',
        voiceSettings: options.voiceSettings ? {
            stability: options.voiceSettings.stability,
            similarityBoost: options.voiceSettings.similarityBoost,
            style: options.voiceSettings.style,
            useSpeakerBoost: options.voiceSettings.useSpeakerBoost,
        } : undefined,
    });

    // Collect all chunks into a buffer
    const chunks: Uint8Array[] = [];

    for await (const chunk of iterateStream(audioData)) {
        if (chunk instanceof Buffer) {
            chunks.push(new Uint8Array(chunk));
        } else if (chunk instanceof Uint8Array) {
            chunks.push(chunk);
        }
    }

    return Buffer.concat(chunks);
}

/**
 * List available voices
 */
export async function listVoices() {
    const elevenlabs = getClient();
    return elevenlabs.voices.search();
}
