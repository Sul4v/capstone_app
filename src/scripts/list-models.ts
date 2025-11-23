import fs from 'fs';
import path from 'path';


async function listModels() {
    let apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        try {
            const envPath = path.join(process.cwd(), '.env.local');
            const envContent = fs.readFileSync(envPath, 'utf-8');
            const match = envContent.match(/GEMINI_API_KEY=(.*)/);
            if (match) {
                apiKey = match[1].trim();
            }
        } catch (e) {
            // ignore
        }
    }

    if (!apiKey) {
        console.error('GEMINI_API_KEY is not set');
        return;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error('Failed to list models:', response.status, response.statusText);
            const text = await response.text();
            console.error(text);
            return;
        }

        const data = await response.json();
        console.log('Available Models:');
        (data.models as any[]).forEach((model: any) => {
            console.log(`- ${model.name} (${model.displayName})`);
            console.log(`  Supported generation methods: ${model.supportedGenerationMethods?.join(', ')}`);
        });
    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
