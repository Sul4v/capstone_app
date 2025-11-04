import { NextResponse } from 'next/server';
import { getExpertResponse } from '@/lib/persona-llm';

type TestPersonaRequest = {
  question?: unknown;
  expertName?: unknown;
  expertiseAreas?: unknown;
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as TestPersonaRequest;
    const { question, expertName, expertiseAreas } = body;

    if (typeof question !== 'string' || !question.trim()) {
      return NextResponse.json(
        { success: false, error: 'Question is required.' },
        { status: 400 },
      );
    }

    if (typeof expertName !== 'string' || !expertName.trim()) {
      return NextResponse.json(
        { success: false, error: 'Expert name is required.' },
        { status: 400 },
      );
    }

    const expertiseArray = Array.isArray(expertiseAreas)
      ? expertiseAreas.filter(
          area => typeof area === 'string' && area.trim(),
        ) as string[]
      : [];

    const response = await getExpertResponse(
      question,
      expertName,
      expertiseArray,
      [],
    );

    return NextResponse.json({ success: true, response });
  } catch (error) {
    console.error('Failed to generate persona response:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate response' },
      { status: 500 },
    );
  }
}
