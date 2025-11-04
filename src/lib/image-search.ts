/**
 * Image Search Helper
 *
 * Fetches relevant images from web using Google Image Search (via SerpApi).
 * Returns normalized image data for display in the media carousel.
 */

import { MediaItem } from '@/types';

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SERPAPI_BASE = 'https://serpapi.com/search.json';

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

        return {
          id: `google-${query.replace(/\s+/g, '-')}-${index}`,
          imageUrl: image.original || image.link,
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

/**
 * Fallback: Search for images on Unsplash (for when SerpApi is unavailable)
 */
async function searchUnsplash(
  query: string,
  perPage: number = 1,
): Promise<MediaItem[]> {
  const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

  if (!UNSPLASH_ACCESS_KEY) {
    return [];
  }

  try {
    const url = new URL('https://api.unsplash.com/search/photos');
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('orientation', 'landscape');
    url.searchParams.set('content_filter', 'high');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return [];
    }

    return data.results.map(
      (image: {
        id: string;
        urls: { regular: string };
        alt_description: string | null;
        description: string | null;
        width: number;
        height: number;
        user: {
          name: string;
          links: { html: string };
        };
        links: { html: string };
      }): MediaItem => ({
        id: `unsplash-${image.id}`,
        imageUrl: image.urls.regular,
        caption: image.alt_description || image.description || query,
        sourceUrl: image.links.html,
        attribution: `Photo by ${image.user.name} on Unsplash`,
        originalQuery: query,
        width: image.width,
        height: image.height,
      }),
    );
  } catch (error) {
    console.error('Error searching Unsplash:', error);
    return [];
  }
}

export interface SearchImagesOptions {
  query: string;
  caption?: string;
  maxResults?: number;
}

/**
 * Search for images (primary: Google via SerpApi, fallback: Unsplash)
 */
export async function searchImages(
  options: SearchImagesOptions,
): Promise<MediaItem[]> {
  const { query, caption, maxResults = 3 } = options;

  if (!query.trim()) {
    return [];
  }

  let results: MediaItem[] = [];

  // Try Google Image Search first (best for technical diagrams & concepts)
  if (SERPAPI_KEY) {
    try {
      results = await searchGoogleImages(query, maxResults);
    } catch (error) {
      console.error('Google Image search failed, trying fallback:', error);
    }
  }

  // Fallback to Unsplash if Google search returned no results
  if (results.length === 0) {
    try {
      results = await searchUnsplash(query, maxResults);
    } catch (error) {
      console.error('Unsplash search also failed:', error);
    }
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
