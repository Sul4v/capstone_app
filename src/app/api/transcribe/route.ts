import { NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/deepgram';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');

    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: 'No audio file provided.' },
        { status: 400 },
      );
    }

    if (typeof audioFile === 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid audio file payload.' },
        { status: 400 },
      );
    }

    const transcript = await transcribeAudio(audioFile);

    return NextResponse.json({
      success: true,
      transcript,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to transcribe audio.';

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: message.includes('API key') ? 500 : 502 },
    );
  }
}
