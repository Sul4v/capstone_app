import { generateGeminiVideo } from '../src/lib/persona-video';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function testVideoGeneration() {
    console.log('Starting video generation test...');

    // Use a placeholder image or a local file if available
    // For this test, we'll try to use a public placeholder image that is a valid face
    // This one is from Unsplash source API
    const imageUrl = 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80';

    console.log(`Downloading image from: ${imageUrl}`);

    try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = response.headers.get('content-type') || 'image/jpeg';

        console.log(`Image downloaded. Size: ${buffer.length} bytes, Type: ${mimeType}`);

        console.log('Calling generateGeminiVideo...');
        const result = await generateGeminiVideo({
            buffer,
            mimeType
        });

        if (result.blocked) {
            console.log('Video generation was BLOCKED.');
            console.log('Reason:', result.reason);
        } else if (result.buffer) {
            console.log('Video generation SUCCESSFUL!');
            const outputPath = path.join(process.cwd(), 'test-output.mp4');
            fs.writeFileSync(outputPath, result.buffer);
            console.log(`Video saved to: ${outputPath}`);
        } else {
            console.log('Video generation FAILED (no buffer returned).');
        }

    } catch (error) {
        console.error('Test failed with error:', error);
    }
}

testVideoGeneration();
