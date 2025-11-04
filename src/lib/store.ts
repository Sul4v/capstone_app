import { create } from 'zustand';
import { CallState, Message, Expert, MediaItem } from '@/types';

interface CallStore extends CallState {
  setSessionId: (id: string | null) => void;
  setIsActive: (active: boolean) => void;
  setCurrentExpert: (expert: Expert | null) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updater: (message: Message) => Message) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setIsListening: (listening: boolean) => void;
  setIsProcessing: (processing: boolean) => void;
  setIsSpeaking: (speaking: boolean) => void;
  setError: (error: string | null) => void;
  setMediaItems: (items: MediaItem[]) => void;
  setIsMediaLoading: (loading: boolean) => void;
  setMediaError: (error: string | null) => void;
  resetMedia: () => void;
  reset: () => void;
}

const getInitialState = (): CallState => ({
  sessionId: null,
  isActive: false,
  currentExpert: null,
  conversationHistory: [],
  isListening: false,
  isProcessing: false,
  isSpeaking: false,
  error: null,
  mediaItems: [],
  isMediaLoading: false,
  mediaError: null,
});

export const useCallStore = create<CallStore>((set) => ({
  ...getInitialState(),

  setSessionId: (id) => set({ sessionId: id }),
  setIsActive: (active) => set({ isActive: active }),
  setCurrentExpert: (expert) => set({ currentExpert: expert }),
  addMessage: (message) =>
    set((state) => ({
      conversationHistory: [...state.conversationHistory, message],
    })),
  updateMessage: (id, updater) =>
    set((state) => ({
      conversationHistory: state.conversationHistory.map((message) =>
        message.id === id ? updater(message) : message,
      ),
    })),
  removeMessage: (id) =>
    set((state) => ({
      conversationHistory: state.conversationHistory.filter(
        (message) => message.id !== id,
      ),
    })),
  clearMessages: () => set({ conversationHistory: [] }),
  setIsListening: (listening) => set({ isListening: listening }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setIsSpeaking: (speaking) => set({ isSpeaking: speaking }),
  setError: (error) => set({ error }),
  setMediaItems: (items) => set({ mediaItems: items }),
  setIsMediaLoading: (loading) => set({ isMediaLoading: loading }),
  setMediaError: (error) => set({ mediaError: error }),
  resetMedia: () =>
    set({
      mediaItems: [],
      isMediaLoading: false,
      mediaError: null,
    }),
  reset: () => set(getInitialState()),
}));
