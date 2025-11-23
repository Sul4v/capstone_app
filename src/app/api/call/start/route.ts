import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { generateSpeech } from '@/lib/elevenlabs';
import { createSession } from '@/lib/sessions';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

const CONCIERGE_VOICE_ID =
  process.env.ELEVENLABS_CONCIERGE_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL';
const GREETING_TEXT =
  "Hello! I'm your AI concierge. I'm here to connect you with expert software engineers. What would you like to know about software engineering today?";
const GREETING_STORAGE_PATH = 'audio/concierge-greeting.mp3';

// In-memory cache for hot execution
let cachedGreetingBuffer: Buffer | null = null;

async function getGreeting(): Promise<Buffer> {
  // 1. Check in-memory cache
  if (cachedGreetingBuffer) {
    console.log('Using in-memory cached greeting');
    return cachedGreetingBuffer;
  }

  // 2. Check persistent storage
  const storedAudio = await storage.download(GREETING_STORAGE_PATH);
  if (storedAudio) {
    console.log('Using storage cached greeting');
    cachedGreetingBuffer = storedAudio;
    return storedAudio;
  }

  // 3. Generate new audio
  console.log('Generating new greeting audio...');
  const audio = await generateSpeech(GREETING_TEXT, CONCIERGE_VOICE_ID);

  // Update caches
  cachedGreetingBuffer = audio;

  // Upload to storage in background (don't await)
  storage.upload(GREETING_STORAGE_PATH, audio).then(() => {
    console.log('Uploaded greeting to storage');
  }).catch(err => {
    console.warn('Failed to upload greeting to storage:', err);
  });

  return audio;
}

export async function POST(): Promise<NextResponse> {
  try {
    const sessionId = randomUUID();

    createSession(sessionId);

    const audioBuffer = await getGreeting();

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
