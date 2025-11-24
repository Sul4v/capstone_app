import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExpertBadge from '@/components/ExpertBadge';
import { Expert } from '@/types';

describe('ExpertBadge', () => {
    it('should render expert details correctly', () => {
        const expert: Expert = {
            id: 'alan-turing',
            name: 'Alan Turing',
            title: 'Father of Computer Science',
            expertiseAreas: ['AI', 'Computing'],
            reasoning: 'Selected for AI expertise',
            gender: 'male',
            description: 'A pioneer',
        };

        render(<ExpertBadge expert={expert} />);

        expect(screen.getByText('Alan Turing')).toBeDefined();
        expect(screen.getByText('Father of Computer Science')).toBeDefined();
        expect(screen.getByText(/AI, Computing/)).toBeDefined();
        expect(screen.getByText('Selected for AI expertise')).toBeDefined();
    });

    it('should render default expertise if empty', () => {
        const expert: Expert = {
            id: 'unknown',
            name: 'Unknown Expert',
            title: '',
            expertiseAreas: [],
            reasoning: '',
            gender: 'neutral',
            description: '',
        };

        render(<ExpertBadge expert={expert} />);

        expect(screen.getByText(/Software Engineering/)).toBeDefined();
    });
});
