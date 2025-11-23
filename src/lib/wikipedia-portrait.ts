import { Portrait } from '@/types';

interface WikipediaImageResponse {
  query?: {
    pages?: {
      [key: string]: {
        title?: string;
        pageimage?: string;
        thumbnail?: {
          source: string;
          width: number;
          height: number;
        };
        original?: {
          source: string;
          width: number;
          height: number;
        };
      };
    };
  };
}

interface WikipediaImageInfoResponse {
  query?: {
    pages?: {
      [key: string]: {
        imageinfo?: Array<{
          url: string;
          descriptionurl: string;
          extmetadata?: {
            Artist?: { value: string };
            LicenseShortName?: { value: string };
            Attribution?: { value: string };
          };
        }>;
      };
    };
  };
}

interface GoogleImageResult {
  link?: string;
  displayLink?: string;
  image?: {
    contextLink?: string;
    thumbnailLink?: string;
  };
}

/**
 * Fetches portrait image from Wikipedia for a given person name
 * @param personName Full name of the person (e.g., "Robert C. Martin")
 * @returns Portrait object with image URL and attribution, or null if not found
 */
export async function fetchWikipediaPortrait(
  personName: string,
): Promise<Portrait | null> {
  try {
    // Step 1: Get page image thumbnail
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
        `Wikipedia API request failed for "${personName}":`,
        pageResponse.status,
      );
      return null;
    }

    const pageData = (await pageResponse.json()) as WikipediaImageResponse;
    const pages = pageData.query?.pages;

    if (!pages) {
      console.warn(`No Wikipedia page found for "${personName}"`);
      return null;
    }

    const page = Object.values(pages)[0];
    if (!page?.thumbnail?.source) {
      console.warn(`No thumbnail image found for "${personName}"`);
      return null;
    }

    const thumbnailUrl = page.thumbnail.source;
    const pageTitle = page.title || personName;

    // Step 2: Get full image info with licensing details
    const imageFileName = page.pageimage;
    if (!imageFileName) {
      // Return with just thumbnail if no full image info available
      return {
        url: thumbnailUrl,
        thumbnailUrl,
        source: 'wikipedia',
        attribution: `Image from Wikipedia article "${pageTitle}"`,
      };
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
      // Return with just thumbnail if image info request fails
      return {
        url: thumbnailUrl,
        thumbnailUrl,
        source: 'wikipedia',
        attribution: `Image from Wikipedia article "${pageTitle}"`,
      };
    }

    const infoData = (await infoResponse.json()) as WikipediaImageInfoResponse;
    const infoPages = infoData.query?.pages;

    if (!infoPages) {
      return {
        url: thumbnailUrl,
        thumbnailUrl,
        source: 'wikipedia',
        attribution: `Image from Wikipedia article "${pageTitle}"`,
      };
    }

    const infoPage = Object.values(infoPages)[0];
    const imageInfo = infoPage?.imageinfo?.[0];

    if (!imageInfo) {
      return {
        url: thumbnailUrl,
        thumbnailUrl,
        source: 'wikipedia',
        attribution: `Image from Wikipedia article "${pageTitle}"`,
      };
    }

    // Extract attribution and license information
    const artist = imageInfo.extmetadata?.Artist?.value;
    const license = imageInfo.extmetadata?.LicenseShortName?.value;
    const attribution = imageInfo.extmetadata?.Attribution?.value;

    let attributionText = `Image from Wikipedia`;
    if (artist) {
      // Remove HTML tags from artist name
      const cleanArtist = artist.replace(/<[^>]*>/g, '');
      attributionText = `Photo by ${cleanArtist}`;
    } else if (attribution) {
      const cleanAttribution = attribution.replace(/<[^>]*>/g, '');
      attributionText = cleanAttribution;
    }

    if (license) {
      attributionText += ` (${license})`;
    }

    return {
      url: imageInfo.url,
      thumbnailUrl,
      source: 'wikipedia',
      attribution: attributionText,
      license: license || undefined,
    };
  } catch (error) {
    console.error(`Error fetching Wikipedia portrait for "${personName}":`, error);
    return null;
  }
}

/**
 * Fetches portrait image from Google Custom Search (images) for a given person
 * Uses GOOGLE_API_KEY and GOOGLE_CSE_ID environment variables if available
 */
export async function fetchGooglePortrait(
  personName: string,
): Promise<Portrait | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId) {
    console.warn(
      '[portrait] GOOGLE_API_KEY or GOOGLE_CSE_ID not set; skipping Google fallback',
    );
    return null;
  }

  try {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('q', personName);
    url.searchParams.set('cx', cseId);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('searchType', 'image');
    url.searchParams.set('num', '3');
    url.searchParams.set('safe', 'high');
    url.searchParams.set('imgType', 'face');

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.warn(
        `[portrait] Google image search failed for "${personName}": ${response.status}`,
      );
      return null;
    }

    const data = (await response.json()) as { items?: GoogleImageResult[] };
    const item = data.items?.find(result => !!result.link);

    if (!item?.link) {
      console.warn(`[portrait] Google image search returned no results for "${personName}"`);
      return null;
    }

    return {
      url: item.link,
      thumbnailUrl: item.image?.thumbnailLink,
      source: 'google',
      attribution: item.displayLink || 'Google Images',
    };
  } catch (error) {
    console.error(`[portrait] Error fetching Google portrait for "${personName}":`, error);
    return null;
  }
}

/**
 * Generate a placeholder portrait with initials
 * @param name Person's name
 * @returns Portrait object with data URL for SVG placeholder
 */
export function generatePlaceholderPortrait(name: string): Portrait {
  const initials = name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Generate a consistent color based on name
  const hash = name.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const hue = Math.abs(hash % 360);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
      <rect width="512" height="512" fill="hsl(${hue}, 50%, 45%)"/>
      <text
        x="256"
        y="256"
        font-family="system-ui, sans-serif"
        font-size="200"
        font-weight="600"
        fill="white"
        text-anchor="middle"
        dominant-baseline="central"
      >${initials}</text>
    </svg>
  `.trim();

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

  return {
    url: dataUrl,
    thumbnailUrl: dataUrl,
    source: 'placeholder',
    attribution: 'Generated placeholder',
  };
}

/**
 * Get or fetch portrait for an expert
 * Tries Wikipedia first, falls back to placeholder
 */
export async function getExpertPortrait(
  expertName: string,
): Promise<Portrait> {
  // Try Wikipedia first
  const wikiPortrait = await fetchWikipediaPortrait(expertName);
  if (wikiPortrait) {
    return wikiPortrait;
  }

  // Fallback to Google Custom Search if configured
  const googlePortrait = await fetchGooglePortrait(expertName);
  if (googlePortrait) {
    return googlePortrait;
  }

  // Fallback to placeholder
  return generatePlaceholderPortrait(expertName);
}
