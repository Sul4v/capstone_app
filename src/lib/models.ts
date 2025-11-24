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
    VIDEO_GENERATION: 'veo-3.1-generate-preview',

    // Deepgram Models
    TRANSCRIPTION: 'nova-2',
} as const;
