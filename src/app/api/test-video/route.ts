import { NextRequest, NextResponse } from 'next/server';
import { generateGeminiVideo, downloadImageBuffer } from '@/lib/persona-video';

export async function POST(req: NextRequest) {
    try {
        const { prompt, imageUrl } = await req.json();

        if (!prompt || !imageUrl) {
            return NextResponse.json(
                { error: 'Missing prompt or imageUrl' },
                { status: 400 },
            );
        }

        const imageDownload = await downloadImageBuffer(imageUrl);
        if (!imageDownload) {
            return NextResponse.json(
                { error: 'Failed to download image' },
                { status: 400 },
            );
        }

        const result = await generateGeminiVideo(imageDownload, prompt);

        if (result.blocked) {
            return NextResponse.json(
                { error: 'Video generation blocked', reason: result.reason },
                { status: 400 },
            );
        }

        if (!result.buffer) {
            return NextResponse.json(
                { error: 'Failed to generate video' },
                { status: 500 },
            );
        }

        if (!result.buffer) {
            return NextResponse.json(
                { error: 'Failed to generate video', details: result },
                { status: 500 }
            );
        }

        return new NextResponse(result.buffer as any, {
            headers: {
                'Content-Type': 'video/mp4',
            },
        });
    } catch (error) {
        console.error('Error in test-video route:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
        );
    }
}
