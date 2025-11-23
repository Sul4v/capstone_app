import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { generateSpeech } from '@/lib/elevenlabs';
import { createSession } from '@/lib/sessions';

export const runtime = 'nodejs';

const CONCIERGE_VOICE_ID =
  process.env.ELEVENLABS_CONCIERGE_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL';
const GREETING_TEXT =
  "Hello! I'm your AI concierge. I'm here to connect you with expert software engineers. What would you like to know about software engineering today?";
const GREETING_CACHE_PATH = '/tmp/concierge-greeting.mp3';

async function getCachedGreeting(): Promise<Buffer | null> {
  try {
    const cached = await fs.readFile(GREETING_CACHE_PATH);
    console.log('Using cached greeting');
    return cached;
  } catch {
    return null;
  }
}

async function cacheGreetingAudio(audio: Buffer): Promise<void> {
  try {
    const dir = path.dirname(GREETING_CACHE_PATH);
    // /tmp should always exist, but just in case
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(GREETING_CACHE_PATH, audio);
    console.log('Cached greeting audio');
  } catch (error) {
    console.warn('Failed to cache greeting audio (non-fatal):', error);
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    const sessionId = randomUUID();

    createSession(sessionId);

    let audioBuffer = await getCachedGreeting();

    if (!audioBuffer) {
      audioBuffer = await generateSpeech(GREETING_TEXT, CONCIERGE_VOICE_ID);
      // Don't await this, let it happen in background or just catch errors inside
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
