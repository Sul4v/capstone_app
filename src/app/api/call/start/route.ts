import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { generateSpeech } from '@/lib/elevenlabs';
import { createSession } from '@/lib/sessions';

const CONCIERGE_VOICE_ID =
  process.env.ELEVENLABS_CONCIERGE_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL';
const GREETING_TEXT =
  "Hello! I'm your AI concierge. I'm here to connect you with expert software engineers. What would you like to know about software engineering today?";
const GREETING_CACHE_PATH = path.join(
  process.cwd(),
  '.cache',
  'concierge-greeting.mp3',
);

async function getCachedGreeting(): Promise<Buffer | null> {
  try {
    const cached = await fs.readFile(GREETING_CACHE_PATH);
    return cached;
  } catch {
    return null;
  }
}

async function cacheGreetingAudio(audio: Buffer): Promise<void> {
  const dir = path.dirname(GREETING_CACHE_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(GREETING_CACHE_PATH, audio);
}

export async function POST(): Promise<NextResponse> {
  try {
    const sessionId = randomUUID();

    createSession(sessionId);

    let audioBuffer = await getCachedGreeting();

    if (!audioBuffer) {
      audioBuffer = await generateSpeech(GREETING_TEXT, CONCIERGE_VOICE_ID);
      await cacheGreetingAudio(audioBuffer);
    }

    const audioBase64 = audioBuffer.toString('base64');

    return NextResponse.json({
      sessionId,
      greetingText: GREETING_TEXT,
      audioBase64,
      success: true,
    });
  } catch (error) {
    console.error('Error starting call:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to start call';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
