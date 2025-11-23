#!/usr/bin/env node
/**
 * Simple CLI to exercise persona video generation.
 *
 * Usage:
 *   node test-persona-video.js "Ada Lovelace"
 *   node test-persona-video.js "Ada Lovelace" https://example.com/portrait.jpg
 *
 * If no portrait URL is provided, the script will try to fetch one from Wikipedia.
 * Requires GEMINI_API_KEY (and optionally GEMINI_VEO_ENDPOINT) to be set in the
 * environment or in .env.local.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const PERSONA_VIDEO_DIR = path.join(__dirname, 'public', 'personas', 'videos');

function normalizeNameToFilename(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function loadEnvValue(key) {
  if (process.env[key]) {
    return process.env[key];
  }

  try {
    const envPath = path.join(__dirname, '.env.local');
    const raw = await fs.readFile(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;

      const currentKey = trimmed.slice(0, eq).trim();
      if (currentKey !== key) continue;

      let value = trimmed.slice(eq + 1).trim();
      value = value.replace(/^['"]/, '').replace(/['"]$/, '');
      return value;
    }
  } catch {
    // Ignore missing env file
  }

  return null;
}

async function fetchWikipediaPortrait(personName) {
  console.log(`🔎 Looking up portrait for "${personName}" on Wikipedia...`);
  try {
    const pageImageUrl = new URL('https://en.wikipedia.org/w/api.php');
    pageImageUrl.searchParams.set('action', 'query');
    pageImageUrl.searchParams.set('titles', personName);
    pageImageUrl.searchParams.set('prop', 'pageimages|pageterms');
    pageImageUrl.searchParams.set('format', 'json');
    pageImageUrl.searchParams.set('formatversion', '2');
    pageImageUrl.searchParams.set('pithumbsize', '512');
    pageImageUrl.searchParams.set('origin', '*');

    const pageResponse = await fetch(pageImageUrl.toString());
    if (!pageResponse.ok) {
      console.warn(
        `  ❌ Wikipedia API request failed: ${pageResponse.status} ${pageResponse.statusText}`,
      );
      return null;
    }

    const pageData = await pageResponse.json();
    const pages = pageData.query?.pages;
    if (!pages) {
      console.warn('  ❌ No Wikipedia page found');
      return null;
    }

    const page = Object.values(pages)[0];
    if (!page?.thumbnail?.source) {
      console.warn('  ❌ No thumbnail image found');
      return null;
    }

    const thumbnailUrl = page.thumbnail.source;
    const pageTitle = page.title || personName;
    console.log(`  ✅ Found thumbnail for "${pageTitle}"`);

    const imageFileName = page.pageimage;
    if (!imageFileName) {
      return { url: thumbnailUrl };
    }

    const imageInfoUrl = new URL('https://en.wikipedia.org/w/api.php');
    imageInfoUrl.searchParams.set('action', 'query');
    imageInfoUrl.searchParams.set('titles', `File:${imageFileName}`);
    imageInfoUrl.searchParams.set('prop', 'imageinfo');
    imageInfoUrl.searchParams.set('iiprop', 'url|extmetadata');
    imageInfoUrl.searchParams.set('format', 'json');
    imageInfoUrl.searchParams.set('origin', '*');

    const infoResponse = await fetch(imageInfoUrl.toString());
    if (!infoResponse.ok) {
      console.warn('  ⚠️  Could not load full image info, falling back to thumbnail.');
      return { url: thumbnailUrl };
    }

    const infoData = await infoResponse.json();
    const infoPages = infoData.query?.pages;
    if (!infoPages) {
      return { url: thumbnailUrl };
    }

    const infoPage = Object.values(infoPages)[0];
    const imageInfo = infoPage?.imageinfo?.[0];
    if (!imageInfo?.url) {
      return { url: thumbnailUrl };
    }

    console.log('  ✅ Found full-resolution image');
    return { url: imageInfo.url };
  } catch (error) {
    console.error('  ❌ Error while fetching portrait:', error);
    return null;
  }
}

async function downloadImageBuffer(url) {
  console.log(`🖼️  Downloading portrait: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[persona-video-test] Failed to download image from ${url}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type');
    return { buffer: Buffer.from(arrayBuffer), mimeType };
  } catch (error) {
    console.warn('[persona-video-test] Error downloading portrait image:', error);
    return null;
  }
}

async function generateGeminiVideo(imageDownload, apiKey, endpoint) {
  const apiEndpoint =
    endpoint ||
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-video-preview:generateVideo';

  const videoRequest = {
    prompt:
      'Create a short, 5-8 second animated character headshot based on the provided reference image. Use a stylized, non-photoreal look (e.g., animated/illustrated) so it is clearly not the real person. Keep the head facing forward, mouth closed, with subtle slow motions to bring the character to life. Do not reference personal names or identities; rely only on visual cues from the image. The video should be loopable and seamless.',
    seedImages: [
      {
        mimeType: imageDownload.mimeType || 'image/jpeg',
        content: imageDownload.buffer.toString('base64'),
      },
    ],
    videoSpec: {
      resolution: '720p',
      durationSeconds: 6,
      fps: 24,
    },
  };

  const url = apiEndpoint.includes('?')
    ? `${apiEndpoint}&key=${apiKey}`
    : `${apiEndpoint}?key=${apiKey}`;

  console.log('🎬 Requesting Gemini Veo video generation...');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(videoRequest),
  });

  if (!response.ok) {
    const responseText = await response.text();
    console.error(
      '[persona-video-test] Gemini Veo request failed:',
      response.status,
      response.statusText,
      responseText,
    );
    return null;
  }

  const payload = await response.json();
  const base64Video = extractBase64Video(payload);
  if (!base64Video) {
    console.error('[persona-video-test] Gemini Veo response missing video payload');
    return null;
  }

  return Buffer.from(base64Video, 'base64');
}

function extractBase64Video(responseBody) {
  if (!responseBody || typeof responseBody !== 'object') {
    return null;
  }

  const root = responseBody;
  const firstCandidates = [
    root.b64Video,
    root.video,
    Array.isArray(root.output) ? root.output[0] : undefined,
    Array.isArray(root.data) ? root.data[0] : undefined,
    Array.isArray(root.candidates) ? root.candidates[0] : undefined,
  ];

  for (const candidate of firstCandidates.flatMap(getAllContentCandidates)) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const normalized = candidate.replace(/\s/g, '');
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  return null;
}

function getAllContentCandidates(value) {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(getAllContentCandidates);

  if (typeof value === 'object') {
    const obj = value;
    const candidates = [];

    if (typeof obj.video === 'string') {
      candidates.push(obj.video);
    }

    if (typeof obj.content !== 'undefined') {
      candidates.push(...getAllContentCandidates(obj.content));
    }

    for (const child of Object.values(obj)) {
      candidates.push(...getAllContentCandidates(child));
    }

    return candidates;
  }

  return [];
}

async function main() {
  const [, , expertName, providedPortraitUrl] = process.argv;
  if (!expertName) {
    console.error('Usage: node test-persona-video.js "Expert Name" [portraitUrl]');
    process.exit(1);
  }

  const apiKey = await loadEnvValue('GEMINI_API_KEY');
  if (!apiKey) {
    console.error(
      'Missing GEMINI_API_KEY. Set it in your environment or .env.local before running.',
    );
    process.exit(1);
  }

  const endpoint =
    process.env.GEMINI_VEO_ENDPOINT || (await loadEnvValue('GEMINI_VEO_ENDPOINT'));

  let portraitUrl = providedPortraitUrl;
  if (!portraitUrl) {
    const portrait = await fetchWikipediaPortrait(expertName);
    if (!portrait?.url) {
      console.error('Could not resolve a portrait URL. Provide one explicitly and retry.');
      process.exit(1);
    }
    portraitUrl = portrait.url;
  }

  const imageDownload = await downloadImageBuffer(portraitUrl);
  if (!imageDownload) {
    console.error('Failed to download portrait image.');
    process.exit(1);
  }

  const videoBuffer = await generateGeminiVideo(imageDownload, apiKey, endpoint);

  if (!videoBuffer) {
    console.error('Gemini did not return a usable video payload.');
    process.exit(1);
  }

  await fs.mkdir(PERSONA_VIDEO_DIR, { recursive: true });
  const fileName = `${normalizeNameToFilename(expertName)}.mp4`;
  const outputPath = path.join(PERSONA_VIDEO_DIR, fileName);
  await fs.writeFile(outputPath, videoBuffer);

  console.log(`✅ Video saved to ${outputPath}`);
}

main().catch(error => {
  console.error('Unexpected error while running test:', error);
  process.exit(1);
});
