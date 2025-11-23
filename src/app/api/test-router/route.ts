import { NextResponse } from 'next/server';
import { routeToExpert } from '@/lib/router';

type TestRouterRequest = {
  question?: unknown;
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as TestRouterRequest & { currentExpertName?: string };
    const { question, currentExpertName } = body;

    if (typeof question !== 'string' || !question.trim()) {
      return NextResponse.json(
        { success: false, error: 'Question is required.' },
        { status: 400 },
      );
    }

    const expert = await routeToExpert(question, { currentExpertName });
    return NextResponse.json({ success: true, expert });
  } catch (error) {
    console.error('Router test endpoint failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to route' },
      { status: 500 },
    );
  }
}
