/**
 * Image Proxy API Route
 *
 * GET /api/image-proxy?url=<encoded-image-url>
 *
 * Proxies external images through our server to bypass:
 * - Ad blockers (ERR_BLOCKED_BY_CLIENT)
 * - CORS restrictions
 * - Browser extension blocking
 *
 * This allows images from any source to be loaded without client-side restrictions.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        // Get the image URL from query params
        const searchParams = request.nextUrl.searchParams;
        const imageUrl = searchParams.get('url');

        if (!imageUrl) {
            return NextResponse.json(
                { error: 'Missing "url" query parameter' },
                { status: 400 },
            );
        }

        // Validate URL format
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(imageUrl);
        } catch {
            return NextResponse.json(
                { error: 'Invalid URL format' },
                { status: 400 },
            );
        }

        // Only allow http/https protocols for security
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return NextResponse.json(
                { error: 'Only HTTP/HTTPS URLs are allowed' },
                { status: 400 },
            );
        }

        // Fetch the image from the external source
        const imageResponse = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ImageProxy/1.0)',
                'Accept': 'image/*, */*',
            },
            // Set a timeout to prevent hanging requests
            signal: AbortSignal.timeout(10000), // 10 seconds
        });

        if (!imageResponse.ok) {
            console.error(`Failed to fetch image from ${imageUrl}: ${imageResponse.status}`);
            return NextResponse.json(
                { error: `Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}` },
                { status: imageResponse.status },
            );
        }

        // Get the image buffer
        const imageBuffer = await imageResponse.arrayBuffer();

        // Get content type from the response or default to image/*
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

        // Return the image with appropriate headers
        return new NextResponse(imageBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (error) {
        console.error('Image proxy error:', error);

        // Handle timeout errors
        if (error instanceof Error && error.name === 'AbortError') {
            return NextResponse.json(
                { error: 'Request timeout while fetching image' },
                { status: 504 },
            );
        }

        // Generic error response
        return NextResponse.json(
            {
                error: 'Failed to proxy image',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 },
        );
    }
}
