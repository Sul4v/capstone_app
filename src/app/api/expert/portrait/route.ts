import { NextResponse } from 'next/server';
import { getExpertPortrait } from '@/lib/wikipedia-portrait';
import {
  buildPersonaVideoStatus,
  getPersonaVideoPublicPath,
  personaVideoExists,
  queuePersonaVideoGeneration,
} from '@/lib/persona-video';

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

    const hasVideo = await personaVideoExists(expertName);

    let portrait = null;
    let portraitUrl: string | undefined;

    if (!hasVideo) {
      portrait = await getExpertPortrait(expertName);
      portraitUrl = portrait?.url;
    }

    const videoStatus = buildPersonaVideoStatus(hasVideo, portraitUrl);
    const videoPath = hasVideo ? getPersonaVideoPublicPath(expertName) : null;

    if (!hasVideo && videoStatus === 'pending' && portraitUrl) {
      queuePersonaVideoGeneration(expertName, portraitUrl);
    }

    return NextResponse.json({
      success: true,
      portrait,
      video: {
        status: videoStatus,
        path: videoPath,
      },
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
