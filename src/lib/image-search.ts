/**
 * Image Search Helper
 *
 * Fetches relevant images from web using Google Image Search (via SerpApi).
 * Returns normalized image data for display in the media carousel.
 */

import { MediaItem } from '@/types';

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SERPAPI_BASE = 'https://serpapi.com/search.json';

/**
 * Wrap an external image URL with our proxy to bypass ad blockers and CORS
 */
function proxyImageUrl(externalUrl: string): string {
  // Encode the external URL as a query parameter
  const encodedUrl = encodeURIComponent(externalUrl);
  return `/api/image-proxy?url=${encodedUrl}`;
}

interface SerpApiImageResult {
  position: number;
  thumbnail: string;
  source: string;
  title: string;
  link: string;
  original: string;
  original_width?: number;
  original_height?: number;
  is_product?: boolean;
}

interface SerpApiResponse {
  search_metadata: {
    status: string;
  };
  images_results?: SerpApiImageResult[];
  error?: string;
}

/**
 * Search for images using Google Image Search via SerpApi
 */
async function searchGoogleImages(
  query: string,
  maxResults: number = 3,
): Promise<MediaItem[]> {
  if (!SERPAPI_KEY) {
    console.warn('SERPAPI_KEY not configured, skipping Google Image search');
    return [];
  }

  try {
    const url = new URL(SERPAPI_BASE);
    url.searchParams.set('engine', 'google_images');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', SERPAPI_KEY);
    url.searchParams.set('num', String(Math.min(maxResults, 10))); // Max 10 per request
    url.searchParams.set('ijn', '0'); // Page number (0-indexed)

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(
        `SerpApi error (${response.status}):`,
        errorText,
      );
      return [];
    }

    const data = (await response.json()) as SerpApiResponse;

    if (data.error) {
      console.error('SerpApi returned error:', data.error);
      return [];
    }

    if (!data.images_results || data.images_results.length === 0) {
      console.log(`No Google Image results for query: "${query}"`);
      return [];
    }

    // Convert to MediaItem format
    return data.images_results
      .slice(0, maxResults)
      .map((image, index): MediaItem => {
        // Safely extract hostname from source
        let sourceName = image.source;
        try {
          // Try to parse as URL if it looks like a full URL
          if (image.source.startsWith('http://') || image.source.startsWith('https://')) {
            sourceName = new URL(image.source).hostname;
          }
          // Otherwise, use as-is (it's already just a domain name)
        } catch {
          // If parsing fails, just use the source as-is
          sourceName = image.source;
        }

        const originalImageUrl = image.original || image.link;

        return {
          id: `google-${query.replace(/\s+/g, '-')}-${index}`,
          imageUrl: proxyImageUrl(originalImageUrl), // Route through proxy
          caption: image.title || query,
          sourceUrl: image.link,
          attribution: `Image from ${sourceName}`,
          originalQuery: query,
          width: image.original_width,
          height: image.original_height,
        };
      });
  } catch (error) {
    console.error('Error searching Google Images via SerpApi:', error);
    return [];
  }
}

export interface SearchImagesOptions {
  query: string;
  caption?: string;
  maxResults?: number;
}

/**
 * Search for images using Google Image Search via SerpApi
 */
export async function searchImages(
  options: SearchImagesOptions,
): Promise<MediaItem[]> {
  const { query, caption, maxResults = 3 } = options;

  if (!query.trim()) {
    return [];
  }

  if (!SERPAPI_KEY) {
    console.warn('SERPAPI_KEY not configured, cannot search for images');
    return [];
  }

  let results: MediaItem[] = [];

  try {
    results = await searchGoogleImages(query, maxResults);
  } catch (error) {
    console.error('Google Image search failed:', error);
    return [];
  }

  // Override caption if provided
  if (caption && results.length > 0) {
    results = results.map(item => ({
      ...item,
      caption,
    }));
  }

  return results;
}

export interface FetchMediaForSuggestionsOptions {
  suggestions: Array<{ query: string; caption: string }>;
  maxImagesPerQuery?: number;
  totalLimit?: number;
}

/**
 * Fetch images for multiple search queries
 */
export async function fetchMediaForSuggestions(
  options: FetchMediaForSuggestionsOptions,
): Promise<MediaItem[]> {
  const { suggestions, maxImagesPerQuery = 2, totalLimit = 5 } = options;

  if (!suggestions || suggestions.length === 0) {
    return [];
  }

  const allResults: MediaItem[] = [];

  // Process queries in parallel
  const searchPromises = suggestions.map(suggestion =>
    searchImages({
      query: suggestion.query,
      caption: suggestion.caption,
      maxResults: maxImagesPerQuery,
    }),
  );

  const resultsArrays = await Promise.allSettled(searchPromises);

  for (const result of resultsArrays) {
    if (result.status === 'fulfilled') {
      allResults.push(...result.value);
    } else {
      console.error('Image search failed:', result.reason);
    }
  }

  // Deduplicate by image URL and limit total results
  const seen = new Set<string>();
  const uniqueResults: MediaItem[] = [];

  for (const item of allResults) {
    if (!seen.has(item.imageUrl) && uniqueResults.length < totalLimit) {
      seen.add(item.imageUrl);
      uniqueResults.push(item);
    }
  }

  return uniqueResults;
}
