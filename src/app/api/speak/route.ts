import { NextResponse } from 'next/server';
import { generateSpeech } from '@/lib/elevenlabs';

type SpeakRequest = {
  text?: unknown;
  voiceId?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SpeakRequest;
    const { text, voiceId } = body;

    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { success: false, error: 'Text is required.' },
        { status: 400 },
      );
    }

    if (typeof voiceId !== 'string' || !voiceId.trim()) {
      return NextResponse.json(
        { success: false, error: 'Voice ID is required.' },
        { status: 400 },
      );
    }

    const audioBuffer = await generateSpeech(text, voiceId);

    return new NextResponse(audioBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to generate speech.';

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: message.includes('API key') ? 500 : 502 },
    );
  }
}
