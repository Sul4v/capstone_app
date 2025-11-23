/**
 * Utilities for persona video management
 */

/**
 * Normalizes an expert/persona name to a video filename
 * Example: "Steve Jobs" -> "steve-jobs"
 */
export function normalizeNameToFilename(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-'); // Remove consecutive hyphens
}

/**
 * Gets the video path for a persona
 * @param name - The persona/expert name
 * @returns The public path to the video file
 */
export function getPersonaVideoPath(name: string): string {
  const normalizedName = normalizeNameToFilename(name);
  const baseUrl = process.env.NEXT_PUBLIC_STORAGE_BASE_URL || '/personas/videos';
  // Handle full URLs (Blob) vs local paths
  if (baseUrl.startsWith('http')) {
    return `${baseUrl.replace(/\/$/, '')}/${normalizedName}.mp4`;
  }
  return `${baseUrl.replace(/\/$/, '')}/${normalizedName}.mp4`;
}

/**
 * Special video identifier for the concierge
 */
export const CONCIERGE_VIDEO_PATH = '/personas/videos/concierge.mp4';

/**
 * Checks if a video exists for a given persona
 * This is a client-side check that attempts to load the video
 */
export async function checkVideoExists(videoPath: string): Promise<boolean> {
  try {
    const response = await fetch(videoPath, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Preloads a video to improve playback performance
 */
export function preloadVideo(videoPath: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = videoPath;
  video.preload = 'auto';
  return video;
}
