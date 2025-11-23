import fs from 'fs';
import path from 'path';
import { queuePersonaVideoGeneration } from '../src/lib/persona-video';

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

const CELEBRITY_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Elon_Musk_Royal_Society_%28crop2%29.jpg/400px-Elon_Musk_Royal_Society_%28crop2%29.jpg';
const TEST_EXPERT_NAME = 'Test Elon Pipeline';

async function runPipelineTest() {
    console.log('Starting pipeline test...');
    console.log(`Expert: ${TEST_EXPERT_NAME}`);
    console.log(`Image: ${CELEBRITY_IMAGE_URL}`);

    const videoPath = path.join(process.cwd(), 'public', 'personas', 'videos', 'test-elon-pipeline.mp4');
    if (fs.existsSync(videoPath)) {
        console.log('Deleting existing video file...');
        fs.unlinkSync(videoPath);
    }

    try {
        console.log('Queueing video generation...');
        const promise = queuePersonaVideoGeneration(TEST_EXPERT_NAME, CELEBRITY_IMAGE_URL);

        if (!promise) {
            console.error('❌ Failed to queue generation (returned null)');
            return;
        }

        console.log('Waiting for generation to complete...');
        await promise;

        console.log('Generation promise resolved.');

        // Check if video file exists
        const videoPath = path.join(process.cwd(), 'public', 'personas', 'videos', 'test-elon-pipeline.mp4');
        if (fs.existsSync(videoPath)) {
            const stats = fs.statSync(videoPath);
            console.log(`✅ SUCCESS! Video file created at ${videoPath}`);
            console.log(`Size: ${stats.size} bytes`);
        } else {
            console.error('❌ FAILED: Video file not found after generation.');
        }

    } catch (error) {
        console.error('❌ Error during pipeline test:', error);
    }
}

runPipelineTest();
