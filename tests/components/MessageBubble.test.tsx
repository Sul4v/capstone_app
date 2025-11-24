import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageBubble from '@/components/MessageBubble';
import { Message } from '@/types';

describe('MessageBubble', () => {
    it('should render user message correctly', () => {
        const message: Message = {
            id: '1',
            role: 'user',
            content: 'Hello World',
            timestamp: new Date('2023-01-01T12:00:00'),
        };

        render(<MessageBubble message={message} />);

        expect(screen.getByText('Hello World')).toBeDefined();
        expect(screen.getByText('You')).toBeDefined();
    });

    it('should render expert message correctly', () => {
        const message: Message = {
            id: '2',
            role: 'expert',
            content: 'Expert Answer',
            expertName: 'Alan Turing',
            timestamp: new Date('2023-01-01T12:01:00'),
        };

        render(<MessageBubble message={message} />);

        expect(screen.getByText('Expert Answer')).toBeDefined();
        expect(screen.getByText('Alan Turing')).toBeDefined();
    });

    it('should render system message correctly', () => {
        const message: Message = {
            id: '3',
            role: 'system',
            content: 'System Notification',
            timestamp: new Date(),
        };

        render(<MessageBubble message={message} />);

        expect(screen.getByText('System Notification')).toBeDefined();
    });
});
