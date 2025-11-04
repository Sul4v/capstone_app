// Message interface - represents a single message in the conversation
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'expert';
  content: string;
  timestamp: Date;
  persona?: string; // ID of the persona that sent/received this message
  expertName?: string;
}

// Persona interface - defines a conversation persona with voice and personality traits
export interface Persona {
  id: string;
  name: string;
  title: string;
  expertise: string[];
  personality: string;
  voiceId: string; // ElevenLabs voice ID
}

// Expert interface - represents a routed subject matter expert for a session
export interface Expert {
  id?: string;
  name: string;
  title?: string;
  expertiseAreas?: string[];
  description?: string;
  reasoning?: string;
  voiceId?: string;
  gender?: 'male' | 'female' | 'neutral' | 'unknown';
}

// Session interface - maintains per-call context including assigned expert
export interface Session {
  sessionId: string;
  expert?: Expert;
  conversationHistory: Message[];
  createdAt: number;
}

export interface MediaItem {
  id: string;
  imageUrl: string;
  caption: string;
  sourceUrl?: string;
  attribution?: string;
  originalQuery?: string;
  width?: number;
  height?: number;
}

// CallState interface - manages the overall state of an active call session
export interface CallState {
  sessionId: string | null;
  isActive: boolean;
  currentExpert: Expert | null;
  conversationHistory: Message[];
  isListening: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  error: string | null;
  mediaItems: MediaItem[];
  isMediaLoading: boolean;
  mediaError: string | null;
}
