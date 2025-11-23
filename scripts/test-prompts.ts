import fs from 'fs';
import path from 'path';
import { generateGeminiVideo, downloadImageBuffer } from '../src/lib/persona-video';

// Load environment variables from .env.local manually
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
            process.env[key] = value;
        }
    });
}

const STYLIZED_IMAGE_PATH = '/Users/sulavshrestha/.gemini/antigravity/brain/4e962188-5c50-4b40-9ecc-add1c798bc6e/elon_lookalike_v3_1763915203279.png';

const TEST_IMAGES = [
    { name: 'Lookalike V3 (Compromise)', url: `file://${STYLIZED_IMAGE_PATH}` },
];

const PROMPTS_TO_TEST = [
    {
        name: 'Standard Animation',
        text: 'Animate this character with subtle motion. Keep it natural.',
    },
];

async function runTests() {
    console.log('Starting prompt tests...');

    for (const image of TEST_IMAGES) {
        console.log(`\nTesting Image: ${image.name} (${image.url})`);
        const imageDownload = await downloadImageBuffer(image.url);
        if (!imageDownload) {
            console.error('Failed to download test image.');
            continue;
        }

        for (const prompt of PROMPTS_TO_TEST) {
            console.log(`Testing Prompt: "${prompt.name}"`);

            try {
                const result = await generateGeminiVideo(imageDownload, prompt.text);

                if (result.blocked) {
                    console.log(`❌ BLOCKED: ${result.reason}`);
                } else if (result.buffer) {
                    console.log(`✅ SUCCESS! Video generated (${result.buffer.length} bytes)`);
                } else {
                    console.log('⚠️ FAILED (No buffer returned)');
                }
            } catch (error) {
                console.error('Error testing prompt:', error);
            }
            console.log('---------------------------------------------------');
        }
    }

    console.log('All tests completed.');
}

runTests();
