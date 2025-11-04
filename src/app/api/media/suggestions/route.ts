/**
 * Media Suggestions API Route
 *
 * POST /api/media/suggestions
 *
 * Accepts context about the current conversation and returns relevant media items
 * (images with captions) to display alongside the persona's response.
 *
 * Flow:
 * 1. Receive transcript, expert response preview, and metadata
 * 2. Use gpt-5-mini to generate 2-3 relevant image search queries
 * 3. Fetch images from web sources (Unsplash, Pexels, etc.)
 * 4. Return normalized media items for display
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateMediaSuggestions } from '@/lib/media-suggestions';
import { fetchMediaForSuggestions } from '@/lib/image-search';

interface RequestBody {
  transcript?: string;
  responsePreview: string;
  expertName?: string;
  expertiseAreas?: string[];
  limit?: number;
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 },
      );
    }

    // Validate request body
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be an object' },
        { status: 400 },
      );
    }

    const {
      transcript,
      responsePreview,
      expertName,
      expertiseAreas,
      limit = 5,
    } = body as RequestBody;

    if (
      typeof responsePreview !== 'string' ||
      !responsePreview.trim()
    ) {
      return NextResponse.json(
        { error: 'responsePreview is required and must be a non-empty string' },
        { status: 400 },
      );
    }

    // Validate optional fields
    if (
      transcript !== undefined &&
      typeof transcript !== 'string'
    ) {
      return NextResponse.json(
        { error: 'transcript must be a string if provided' },
        { status: 400 },
      );
    }

    if (
      expertName !== undefined &&
      typeof expertName !== 'string'
    ) {
      return NextResponse.json(
        { error: 'expertName must be a string if provided' },
        { status: 400 },
      );
    }

    if (
      expertiseAreas !== undefined &&
      !Array.isArray(expertiseAreas)
    ) {
      return NextResponse.json(
        { error: 'expertiseAreas must be an array if provided' },
        { status: 400 },
      );
    }

    if (
      typeof limit !== 'number' ||
      limit < 1 ||
      limit > 10
    ) {
      return NextResponse.json(
        { error: 'limit must be a number between 1 and 10' },
        { status: 400 },
      );
    }

    // Step 1: Generate search query suggestions using gpt-5-mini
    console.log('[Media Suggestions] Generating search queries...');
    const suggestions = await generateMediaSuggestions({
      transcript,
      responsePreview,
      expertName,
      expertiseAreas,
      limit: Math.min(3, limit),
    });

    if (suggestions.length === 0) {
      console.log('[Media Suggestions] No suggestions generated');
      return NextResponse.json({
        items: [],
        suggestions: [],
      });
    }

    console.log(
      `[Media Suggestions] Generated ${suggestions.length} search queries:`,
      suggestions.map(s => s.query),
    );

    // Step 2: Fetch images for the generated queries
    console.log('[Media Suggestions] Fetching images...');
    const mediaItems = await fetchMediaForSuggestions({
      suggestions,
      maxImagesPerQuery: 2,
      totalLimit: limit,
    });

    console.log(
      `[Media Suggestions] Fetched ${mediaItems.length} media items`,
    );

    // Return results
    return NextResponse.json({
      items: mediaItems,
      suggestions: suggestions.map(s => ({
        query: s.query,
        caption: s.caption,
      })),
    });
  } catch (error) {
    console.error('[Media Suggestions API] Error:', error);

    // Handle specific error types
    if (error instanceof Error) {
      // OpenAI API errors
      if (error.message.includes('API key')) {
        return NextResponse.json(
          { error: 'OpenAI API configuration error' },
          { status: 500 },
        );
      }

      // Rate limiting
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please try again later.' },
          { status: 429 },
        );
      }

      // Timeout errors
      if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        return NextResponse.json(
          { error: 'Request timeout. Please try again.' },
          { status: 504 },
        );
      }
    }

    // Generic error response
    return NextResponse.json(
      {
        error: 'Failed to generate media suggestions',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
