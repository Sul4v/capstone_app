import fs from 'node:fs/promises';
import { normalizeNameToFilename } from '@/lib/video-utils';
import { VIDEO_GENERATION_PROMPT } from '@/lib/prompts';
import { storage } from '@/lib/storage';
import { generateLookalikeImage, describeImage } from '@/lib/image-generation';
// The following functions are defined in this file, so no self-import is needed here.
// If they were moved to a separate file, this import would be necessary.
// import { downloadImageBuffer, generateGeminiVideo } from '@/lib/persona-video';

type VideoGenerationStatus = 'ready' | 'pending' | 'missing';

const pendingPersonaVideoGenerations = new Map<string, Promise<void>>();
const blockedPersonaVideoGenerations = new Set<string>();

function getVideoFileName(expertName: string): string {
  const normalized = normalizeNameToFilename(expertName);
  return `${normalized}.mp4`;
}

// Removed getAbsoluteVideoPath as it's FS specific

export function getPersonaVideoPublicPath(expertName: string): string {
  // This might need to be dynamic based on storage, but for now we rely on video-utils on client
  // or we can return the storage URL if we had it.
  // For local, it matches. For blob, client needs to know base URL.
  return `/personas/videos/${getVideoFileName(expertName)}`;
}

export async function personaVideoExists(expertName: string): Promise<boolean> {
  return storage.exists(getVideoFileName(expertName));
}

export function buildPersonaVideoStatus(
  exists: boolean,
  portraitUrl?: string,
): VideoGenerationStatus {
  if (exists) {
    return 'ready';
  }
  if (portraitUrl && /^https?:\/\//i.test(portraitUrl)) {
    return 'pending';
  }
  return 'missing';
}

export function queuePersonaVideoGeneration(
  expertName: string,
  portraitUrl: string,
): Promise<void> | null {
  const normalizedName = normalizeNameToFilename(expertName);
  const fileName = getVideoFileName(expertName);

  if (blockedPersonaVideoGenerations.has(normalizedName)) {
    return null;
  }

  if (!portraitUrl || !/^https?:\/\//i.test(portraitUrl)) {
    return null;
  }

  const existing = pendingPersonaVideoGenerations.get(normalizedName);
  if (existing) {
    return existing;
  }

  const generationPromise = (async () => {
    try {
      // 1. Download Original Image
      console.log(`[persona-video] Downloading original image for "${expertName}"...`);
      const originalImage = await downloadImageBuffer(portraitUrl);
      if (!originalImage) {
        throw new Error('Could not download portrait image');
      }

      // 2. Analyze Image (Visual Description)
      console.log(`[persona-video] Analyzing image for "${expertName}"...`);
      const base64Image = originalImage.buffer.toString('base64');
      const mimeType = originalImage.mimeType || 'image/jpeg';
      const visualDescription = await describeImage(base64Image, mimeType);

      if (!visualDescription) {
        console.warn(`[persona-video] Failed to describe image for "${expertName}". Using generic fallback.`);
      } else {
        console.log(`[persona-video] Generated visual description for "${expertName}"`);
      }

      // 3. Generate Lookalike Image
      console.log(`[persona-video] Generating lookalike for "${expertName}"...`);
      const lookalikeUrl = await generateLookalikeImage(expertName, visualDescription || undefined);
      if (!lookalikeUrl) {
        throw new Error('Failed to generate lookalike image');
      }
      console.log(`[persona-video] Generated lookalike image: ${lookalikeUrl}`);

      // 4. Download Lookalike Image
      const lookalikeImage = await downloadImageBuffer(lookalikeUrl);
      if (!lookalikeImage) {
        throw new Error('Could not download generated lookalike image');
      }

      // 5. Generate Video
      console.log(`[persona-video] Generating video for "${expertName}" using lookalike...`);
      const videoResult = await generateGeminiVideo(lookalikeImage);

      if (videoResult.blocked) {
        blockedPersonaVideoGenerations.add(normalizedName);
        console.warn(
          `[persona-video] Video generation blocked for "${expertName}"${videoResult.reason ? `: ${videoResult.reason}` : ''
          }`,
        );
        return;
      }

      const videoBuffer = videoResult.buffer;
      if (!videoBuffer) {
        throw new Error('Gemini Veo did not return a video payload');
      }

      // 6. Upload Video
      console.log(`[persona-video] Uploading video for "${expertName}"...`);
      const publicUrl = await storage.upload(fileName, videoBuffer);
      console.log(`[persona-video] Successfully generated and uploaded video for "${expertName}" to ${publicUrl}`);

    } catch (error) {
      console.error(
        `[persona-video] Failed to generate video for "${expertName}":`,
        error,
      );
    } finally {
      pendingPersonaVideoGenerations.delete(normalizedName);
    }
  })();

  pendingPersonaVideoGenerations.set(normalizedName, generationPromise);
  return generationPromise;
}

interface DownloadedImage {
  buffer: Buffer;
  mimeType: string | null;
}

interface VideoGenerationResult {
  buffer: Buffer | null;
  blocked: boolean;
  reason?: string;
}

export async function downloadImageBuffer(url: string): Promise<DownloadedImage | null> {
  try {
    if (url.startsWith('file://')) {
      const filePath = url.replace('file://', '');
      const buffer = await fs.readFile(filePath);
      return { buffer, mimeType: 'image/png' }; // Assuming PNG from generate_image
    }

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[persona-video] Failed to download image from ${url}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type');
    return { buffer: Buffer.from(arrayBuffer), mimeType };
  } catch (error) {
    console.warn('[persona-video] Error downloading portrait image:', error);
    return null;
  }
}

export async function generateGeminiVideo(
  imageDownload: DownloadedImage,
  customPrompt?: string,
): Promise<VideoGenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[persona-video] GEMINI_API_KEY is not set');
    return { buffer: null, blocked: false };
  }

  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  const model = 'veo-3.1-generate-preview';
  const url = `${baseUrl}/models/${model}:predictLongRunning?key=${apiKey}`;

  const videoRequest = {
    instances: [
      {
        // Keep prompt generic so we do not send persona names to Gemini
        prompt: customPrompt || VIDEO_GENERATION_PROMPT(),
        image: {
          bytesBase64Encoded: imageDownload.buffer.toString('base64'),
          mimeType: imageDownload.mimeType || 'image/jpeg',
        },
      },
    ],
  };

  try {
    // Step 1: Start Operation
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(videoRequest),
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(
          '[persona-video] Video generation model not found (404). Skipping video generation.',
        );
        return { buffer: null, blocked: false };
      }

      const responseText = await response.text();
      console.error(
        '[persona-video] Failed to start video generation:',
        response.status,
        response.statusText,
        responseText,
      );
      return { buffer: null, blocked: false };
    }

    const initialData = await response.json();
    const operationName = initialData.name; // e.g., "operations/..."

    if (!operationName) {
      console.error('[persona-video] No operation name returned');
      return { buffer: null, blocked: false };
    }

    console.log(`[persona-video] Started video generation: ${operationName}`);

    // Step 2: Poll Status
    let videoUri: string | null = null;
    const maxAttempts = 60; // 10 minutes (if 10s delay)

    for (let i = 0; i < maxAttempts; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10s delay

      const statusUrl = `${baseUrl}/${operationName}?key=${apiKey}`;
      const statusResponse = await fetch(statusUrl);

      if (!statusResponse.ok) {
        console.error('[persona-video] Failed to poll status');
        return { buffer: null, blocked: false };
      }

      const statusData = await statusResponse.json();

      if (statusData.done) {
        if (statusData.error) {
          console.error('[persona-video] Generation failed:', statusData.error);
          return { buffer: null, blocked: false };
        }

        console.log(
          '[persona-video] Operation done. Full response:',
          JSON.stringify(statusData, null, 2),
        );

        const filteredCount =
          statusData.response?.generateVideoResponse?.raiMediaFilteredCount || 0;
        const filteredReasons = Array.isArray(
          statusData.response?.generateVideoResponse?.raiMediaFilteredReasons,
        )
          ? statusData.response.generateVideoResponse.raiMediaFilteredReasons
          : [];

        if (filteredCount > 0 || filteredReasons.length) {
          return {
            buffer: null,
            blocked: true,
            reason: filteredReasons.length ? filteredReasons.join('; ') : undefined,
          };
        }

        // Extract URI
        const samples =
          statusData.response?.generateVideoResponse?.generatedSamples;
        if (samples && samples.length > 0) {
          videoUri = samples[0].video?.uri;
        }
        break;
      }

      console.log(`[persona-video] Polling... (${i + 1}/${maxAttempts})`);
    }

    if (!videoUri) {
      console.error('[persona-video] Timed out or failed to get video URI');
      return { buffer: null, blocked: false };
    }

    // Step 3: Download Video
    console.log(`[persona-video] Downloading video from ${videoUri}`);
    const downloadRes = await fetch(videoUri, {
      headers: { 'x-goog-api-key': apiKey },
    });

    if (!downloadRes.ok) {
      console.error('[persona-video] Failed to download video');
      return { buffer: null, blocked: false };
    }

    const arrayBuffer = await downloadRes.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), blocked: false };
  } catch (error) {
    console.error('[persona-video] Error during video generation:', error);
    return { buffer: null, blocked: false };
  }
}
