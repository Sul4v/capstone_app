import OpenAI from 'openai';
import { MODELS } from '@/lib/models';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function describeImage(
    imageBase64: string,
    mimeType: string = 'image/jpeg',
): Promise<string | null> {
    try {
        const response = await openai.chat.completions.create({
            model: MODELS.IMAGE_ANALYSIS,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Analyze this image and provide a detailed physical description of the person suitable for regenerating a lookalike. Focus on: age, gender, hair style/color, facial hair, glasses, clothing, and general vibe. Do NOT mention their name or that they are a celebrity. Keep it objective.',
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${imageBase64}`,
                            },
                        },
                    ],
                },
            ],
            max_completion_tokens: 150,
        });

        return response.choices[0]?.message?.content || null;
    } catch (error) {
        console.error('[image-generation] Failed to describe image:', error);
        return null;
    }
}

export async function generateLookalikeImage(
    expertName: string,
    visualDescription?: string,
): Promise<string | null> {
    try {
        const descriptionPart = visualDescription
            ? `Visual traits: ${visualDescription}`
            : `A professional expert who looks like a ${expertName}`;

        const prompt = `Create a professional, passport-style headshot of a person. 
    ${descriptionPart}
    The person should be facing forward, centered in the frame, with a neutral or slightly friendly expression.
    The background should be a plain, neutral color (white or light grey).
    The style should be realistic but clearly a generated character to avoid identity issues.
    Do NOT generate a specific real person or celebrity. Create a generic lookalike character.
    High quality, sharp focus, good lighting.`;

        const response = await openai.images.generate({
            model: 'dall-e-3',
            prompt,
            n: 1,
            size: '1024x1024',
            response_format: 'url',
        });

        return response.data?.[0]?.url || null;
    } catch (error) {
        console.error('[image-generation] Failed to generate lookalike image:', error);
        return null;
    }
}
