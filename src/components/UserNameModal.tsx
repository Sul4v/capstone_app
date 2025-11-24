'use client';

import { useState, useEffect } from 'react';
import { useCallStore } from '@/lib/store';

export default function UserNameModal() {
    const { userName, setUserName } = useCallStore();
    const [isOpen, setIsOpen] = useState(false);
    const [nameInput, setNameInput] = useState('');

    useEffect(() => {
        // Check local storage on mount
        const storedName = localStorage.getItem('user_name');
        if (storedName) {
            setUserName(storedName);
        } else if (!userName) {
            // If no name in storage or store, open modal
            setIsOpen(true);
        }
    }, [setUserName, userName]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = nameInput.trim();
        if (trimmedName) {
            localStorage.setItem('user_name', trimmedName);
            setUserName(trimmedName);
            setIsOpen(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl animate-in fade-in zoom-in-95 duration-300">
                <div className="p-8">
                    <h2 className="text-2xl font-bold text-white mb-2">Welcome!</h2>
                    <p className="text-slate-400 mb-6">
                        Please enter your name so we can personalize your experience.
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="name" className="sr-only">Name</label>
                            <input
                                type="text"
                                id="name"
                                value={nameInput}
                                onChange={(e) => setNameInput(e.target.value)}
                                placeholder="Your Name"
                                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                                autoFocus
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={!nameInput.trim()}
                            className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white transition-all hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
                        >
                            Continue
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
