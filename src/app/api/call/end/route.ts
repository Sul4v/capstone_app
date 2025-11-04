import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/sessions';

type EndCallRequest = {
  sessionId?: unknown;
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as EndCallRequest;
    const { sessionId } = body;

    if (typeof sessionId === 'string' && sessionId.trim()) {
      deleteSession(sessionId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error ending call:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to end call';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
