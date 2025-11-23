import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
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

    console.log(`[portrait] Expert: "${expertName}", HasVideo: ${hasVideo}, Status: ${videoStatus}`);

    if (!hasVideo && videoStatus === 'pending') {
      console.log(`[portrait] Triggering video generation for "${expertName}"`);
      // Trigger generation even if portraitUrl is missing (will use name-only fallback)
      // Use waitUntil to ensure background task survives response
      const generationPromise = queuePersonaVideoGeneration(expertName, portraitUrl || '');
      if (generationPromise) {
        console.log(`[portrait] Video generation queued (waitUntil)`);
        waitUntil(generationPromise);
      } else {
        console.log(`[portrait] Video generation skipped (already pending or blocked)`);
      }
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
