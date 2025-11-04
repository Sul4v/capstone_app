import { Session, Expert, Message } from '@/types';

// Simple in-memory storage (resets on server restart, acceptable for MVP)
const sessions = new Map<string, Session>();

export function createSession(sessionId: string): Session {
  const session: Session = {
    sessionId,
    expert: undefined,
    conversationHistory: [],
    createdAt: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function updateSession(
  sessionId: string,
  updates: Partial<Session>,
): void {
  const session = sessions.get(sessionId);
  if (session) {
    sessions.set(sessionId, { ...session, ...updates });
  }
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function setSessionExpert(sessionId: string, expert: Expert): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.expert = expert;
  }
}

export function addMessageToSession(
  sessionId: string,
  message: Message,
): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.conversationHistory.push(message);
  }
}
