/**
 * ElevenLabs HTTP Streaming API
 * 
 * This uses the simpler HTTP streaming endpoint instead of WebSocket.
 * According to ElevenLabs docs, HTTP streaming is recommended when
 * the input text is available (or can be buffered) upfront.
 * 
 * Reference: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
 */

export type ElevenLabsHttpStreamOptions = {
    voiceId: string;
    modelId?: string;
    text: string;
    voiceSettings?: {
        stability?: number;
        similarity_boost?: number;
        style?: number;
        speed?: number;
    };
    outputFormat?: string;
    optimizeStreamingLatency?: number;
};

export type ElevenLabsHttpStreamResult = {
    audioStream: ReadableStream<Uint8Array>;
    contentType: string;
};

/**
 * Streams text-to-speech audio using ElevenLabs HTTP API.
 * Returns a ReadableStream of audio bytes.
 */
export async function streamTextToSpeech(
    options: ElevenLabsHttpStreamOptions
): Promise<ElevenLabsHttpStreamResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY.');
    }

    const voiceId = options.voiceId;
    if (!voiceId) {
        throw new Error('Voice ID required for ElevenLabs TTS.');
    }

    const modelId = options.modelId ?? 'eleven_flash_v2_5';
    const outputFormat = options.outputFormat ?? 'mp3_44100_128';

    // Build URL with query parameters
    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`);
    url.searchParams.set('output_format', outputFormat);

    // Latency optimization: 0-4, where 4 is max optimization
    if (options.optimizeStreamingLatency !== undefined) {
        url.searchParams.set('optimize_streaming_latency', String(options.optimizeStreamingLatency));
    }

    const body: Record<string, unknown> = {
        text: options.text,
        model_id: modelId,
    };

    if (options.voiceSettings) {
        body.voice_settings = options.voiceSettings;
    }

    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        // Try to get error details from response
        let errorMessage = `ElevenLabs API error: ${response.status} ${response.statusText}`;
        try {
            const errorBody = await response.json();
            if (errorBody?.detail?.message) {
                errorMessage = errorBody.detail.message;
            } else if (errorBody?.detail) {
                errorMessage = typeof errorBody.detail === 'string'
                    ? errorBody.detail
                    : JSON.stringify(errorBody.detail);
            }
        } catch {
            // Ignore JSON parse errors
        }
        throw new Error(errorMessage);
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';

    if (!response.body) {
        throw new Error('ElevenLabs API returned no response body');
    }

    return {
        audioStream: response.body,
        contentType,
    };
}

/**
 * Converts a full text to speech and returns the audio as a buffer.
 * Useful when you want the complete audio at once.
 */
export async function textToSpeechBuffer(
    options: ElevenLabsHttpStreamOptions
): Promise<{ audioBuffer: Buffer; contentType: string }> {
    const { audioStream, contentType } = await streamTextToSpeech(options);

    const chunks: Uint8Array[] = [];
    const reader = audioStream.getReader();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
    }

    const audioBuffer = Buffer.concat(chunks);
    return { audioBuffer, contentType };
}
