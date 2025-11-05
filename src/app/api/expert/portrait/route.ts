import { NextResponse } from 'next/server';
import { getExpertPortrait } from '@/lib/wikipedia-portrait';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const expertName = searchParams.get('name');

    if (!expertName || typeof expertName !== 'string') {
      return NextResponse.json(
        { error: 'Expert name is required' },
        { status: 400 },
      );
    }

    const portrait = await getExpertPortrait(expertName);

    return NextResponse.json({
      success: true,
      portrait,
    });
  } catch (error) {
    console.error('Error fetching expert portrait:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch portrait',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
