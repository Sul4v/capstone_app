import { describe, it, expect } from 'vitest';
import {
    PERSONA_SYSTEM_PROMPT,
    MEDIA_SUGGESTION_SYSTEM_PROMPT,
    VIDEO_GENERATION_PROMPT,
    ROUTER_SYSTEM_PROMPT,
} from '@/lib/prompts';

describe('Prompts', () => {
    describe('PERSONA_SYSTEM_PROMPT', () => {
        it('should generate a prompt with the given expert name and expertise', () => {
            const expertName = 'Alan Turing';
            const expertise = 'Computer Science, Artificial Intelligence';
            const prompt = PERSONA_SYSTEM_PROMPT(expertName, expertise);

            expect(prompt).toContain('You are Alan Turing');
            expect(prompt).toContain('Computer Science, Artificial Intelligence');
            expect(prompt).toContain('Stay completely in character as Alan Turing');
        });
    });

    describe('MEDIA_SUGGESTION_SYSTEM_PROMPT', () => {
        it('should be a string containing specific instructions', () => {
            expect(MEDIA_SUGGESTION_SYSTEM_PROMPT).toContain('You are a visual content curator');
            expect(MEDIA_SUGGESTION_SYSTEM_PROMPT).toContain('valid JSON array');
        });
    });

    describe('VIDEO_GENERATION_PROMPT', () => {
        it('should return the standard video generation prompt', () => {
            const prompt = VIDEO_GENERATION_PROMPT();
            expect(prompt).toBe('Animate this character with subtle motion. Keep it natural. Do not change the identity.');
        });
    });

    describe('ROUTER_SYSTEM_PROMPT', () => {
        it('should be a string containing routing instructions', () => {
            expect(ROUTER_SYSTEM_PROMPT).toContain('You are an expert routing system');
            expect(ROUTER_SYSTEM_PROMPT).toContain('Return ONLY valid JSON');
        });
    });
});
