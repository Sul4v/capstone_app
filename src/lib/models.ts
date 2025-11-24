/**
 * Centralized configuration for AI models used in the application.
 * Edit these values to change the models used across the app.
 */

export const MODELS = {
    // OpenAI Models
    PERSONA_CHAT: 'gpt-5.1',
    ROUTER: 'gpt-5-mini',
    MEDIA_SUGGESTION: 'gpt-5-mini', // Note: media-suggestions.ts has specific logic for gpt-5 models
    IMAGE_GENERATION: 'dall-e-3',
    IMAGE_ANALYSIS: 'gpt-5-nano',

    // Google Models
    VIDEO_GENERATION: 'veo-2.0-generate-001',

    // 'veo-3.1-generate-preview' for 3.1 Rate limit is 10 per day

    // Deepgram Models
    TRANSCRIPTION: 'nova-2',
} as const;
