import { describe, it, expect, beforeEach } from 'vitest';
import { useCallStore } from '@/lib/store';

describe('useCallStore', () => {
    beforeEach(() => {
        useCallStore.getState().reset();
    });

    it('should have initial state', () => {
        const state = useCallStore.getState();
        expect(state.sessionId).toBeNull();
        expect(state.isActive).toBe(false);
        expect(state.conversationHistory).toEqual([]);
    });

    it('should set session ID', () => {
        useCallStore.getState().setSessionId('test-session-id');
        expect(useCallStore.getState().sessionId).toBe('test-session-id');
    });

    it('should set active state', () => {
        useCallStore.getState().setIsActive(true);
        expect(useCallStore.getState().isActive).toBe(true);
    });

    it('should add a message', () => {
        const message = {
            id: '1',
            role: 'user' as const,
            content: 'Hello',
            timestamp: new Date(),
        };
        useCallStore.getState().addMessage(message);
        expect(useCallStore.getState().conversationHistory).toHaveLength(1);
        expect(useCallStore.getState().conversationHistory[0]).toEqual(message);
    });

    it('should update a message', () => {
        const message = {
            id: '1',
            role: 'user' as const,
            content: 'Hello',
            timestamp: new Date(),
        };
        useCallStore.getState().addMessage(message);

        useCallStore.getState().updateMessage('1', (msg) => ({
            ...msg,
            content: 'Hello Updated',
        }));

        expect(useCallStore.getState().conversationHistory[0].content).toBe('Hello Updated');
    });

    it('should remove a message', () => {
        const message = {
            id: '1',
            role: 'user' as const,
            content: 'Hello',
            timestamp: new Date(),
        };
        useCallStore.getState().addMessage(message);
        useCallStore.getState().removeMessage('1');
        expect(useCallStore.getState().conversationHistory).toHaveLength(0);
    });

    it('should clear messages', () => {
        const message = {
            id: '1',
            role: 'user' as const,
            content: 'Hello',
            timestamp: new Date(),
        };
        useCallStore.getState().addMessage(message);
        useCallStore.getState().clearMessages();
        expect(useCallStore.getState().conversationHistory).toHaveLength(0);
    });
});
