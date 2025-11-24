import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeToExpert } from '@/lib/router';
import OpenAI from 'openai';

// Mock OpenAI
vi.mock('openai', () => {
    const mockCreate = vi.fn();
    return {
        default: class {
            chat = {
                completions: {
                    create: mockCreate,
                },
            };
        },
    };
});

describe('routeToExpert', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should route to an expert based on OpenAI response', async () => {
        const mockResponse = {
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            expertName: 'Grace Hopper',
                            expertiseAreas: ['COBOL', 'Compilers'],
                            reasoning: 'Pioneer of computer programming',
                            gender: 'female',
                        }),
                    },
                },
            ],
        };

        // Get the mock function from the mocked module
        const openai = new OpenAI({ apiKey: 'test' });
        (openai.chat.completions.create as any).mockResolvedValue(mockResponse);

        const expert = await routeToExpert('Tell me about compilers');

        expect(expert.name).toBe('Grace Hopper');
        expect(expert.id).toBe('grace-hopper');
        expect(expert.expertiseAreas).toEqual(['COBOL', 'Compilers']);
        expect(expert.gender).toBe('female');
    });

    it('should fallback to default expert on API error', async () => {
        const openai = new OpenAI({ apiKey: 'test' });
        (openai.chat.completions.create as any).mockRejectedValue(new Error('API Error'));

        const expert = await routeToExpert('Tell me about compilers');

        expect(expert.name).toBe('Martin Fowler');
        expect(expert.id).toBe('martin-fowler');
    });

    it('should fallback to default expert on invalid JSON', async () => {
        const mockResponse = {
            choices: [
                {
                    message: {
                        content: 'Invalid JSON',
                    },
                },
            ],
        };

        const openai = new OpenAI({ apiKey: 'test' });
        (openai.chat.completions.create as any).mockResolvedValue(mockResponse);

        const expert = await routeToExpert('Tell me about compilers');

        expect(expert.name).toBe('Martin Fowler');
    });
});
