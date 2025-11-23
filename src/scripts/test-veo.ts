import fs from 'fs';
import path from 'path';


async function testVeo() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        // Try reading from .env.local if not in env
        try {
            const envPath = path.join(process.cwd(), '.env.local');
            const envContent = fs.readFileSync(envPath, 'utf-8');
            const match = envContent.match(/GEMINI_API_KEY=(.*)/);
            if (match) {
                process.env.GEMINI_API_KEY = match[1].trim();
            }
        } catch (e) {
            console.error('Could not read .env.local');
            return;
        }
    }

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error('No API key found');
        return;
    }

    console.log('Testing Veo 3.1 API...');

    // 1. Get a sample image (1x1 transparent pixel or similar small image)
    // Using a small base64 directly for testing
    const base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const mimeType = "image/png";

    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    const model = 'veo-3.1-generate-preview';
    const url = `${baseUrl}/models/${model}:predictLongRunning?key=${key}`;

    // Test Payload 1: Current implementation
    const payload1 = {
        instances: [
            {
                prompt: "A cinematic shot of a futuristic city.",
                image: {
                    bytesBase64Encoded: base64Image,
                    mimeType: mimeType
                }
            }
        ]
    };

    console.log('Sending Payload 1:', JSON.stringify(payload1, null, 2));

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload1),
        });

        if (!response.ok) {
            console.error('Error:', response.status, response.statusText);
            console.error(await response.text());
        } else {
            console.log('Success!', await response.json());
        }
    } catch (error) {
        console.error('Fetch error:', error);
    }
}

testVeo();
