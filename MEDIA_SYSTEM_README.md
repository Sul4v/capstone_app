# Media Fetch System Documentation

## Overview

The media fetch system automatically displays relevant images alongside the persona's audio response during a call. Images are fetched in real-time based on the conversation context and displayed in the left-panel media carousel.

## How It Works

### 1. **Parallel Processing Flow**

```
User asks question
    ↓
Persona starts responding (streaming text + audio)
    ↓
[PARALLEL EXECUTION]
    ↓
    ├─→ Audio plays to user
    └─→ Media fetch triggers (when enough text is available)
        ↓
        Step 1: LLM generates 2-3 image search queries
        Step 2: Fetch images from web sources
        Step 3: Display in carousel
```

### 2. **Components**

#### **Frontend (CallInterface.tsx)**
- Monitors incoming text response chunks
- Triggers media fetch when:
  - **Preview**: First complete sentence (~80+ chars with punctuation)
  - **Final**: When response is complete
- Updates carousel with fetched images
- Shows loading state during fetch
- Falls back to placeholder cards if no images

#### **Backend Services**

**`/api/media/suggestions`** (API Route)
- Receives: User question, expert response preview, context
- Returns: Array of media items with images and captions

**`lib/media-suggestions.ts`** (LLM Query Generator)
- Uses OpenAI's `gpt-5-mini` model
- Analyzes conversation context
- Generates 2-3 specific image search queries
- Returns queries with captions (8-12 words each)

**`lib/image-search.ts`** (Image Provider)
- Fetches images from Unsplash (primary) and/or Pexels (fallback)
- Handles multiple providers with graceful degradation
- Deduplicates results
- Normalizes to consistent `MediaItem` format

## Setup Instructions

### 1. **Get API Keys**

#### SerpApi (Primary - **REQUIRED** for best results)
SerpApi provides real Google Image Search results - perfect for technical diagrams, concepts, and educational content.

1. Go to [SerpApi.com](https://serpapi.com)
2. Sign up for a free account
3. You get **100 free searches per month** (no credit card required!)
4. Go to your dashboard and copy your API key
5. Add to `.env.local`:
   ```bash
   SERPAPI_KEY=your_serpapi_api_key_here
   ```

**Why SerpApi?**
- ✅ Real Google Image Search results
- ✅ Perfect for technical diagrams, infographics, concept illustrations
- ✅ 100 free searches/month (plenty for development/testing)
- ✅ Returns exactly what you'd see on Google Images

#### Unsplash (Optional - Fallback)
Only used if SerpApi is unavailable or quota is exhausted. Good for photography, not ideal for technical content.

1. Go to [Unsplash Developers](https://unsplash.com/developers) (optional)
2. Your existing key will be used as fallback automatically

#### OpenAI (Already Required)
The media system uses your existing `OPENAI_API_KEY` for generating search queries with `gpt-5-mini`.

### 2. **Configuration Options**

You can customize the media system behavior in `.env.local`:

```bash
# Optional: Override the LLM model for media suggestions
# Default: gpt-5-mini
MEDIA_SUGGESTION_MODEL=gpt-5-mini

# Or use a different model:
# MEDIA_SUGGESTION_MODEL=gpt-4o-mini
```

**⚠️ Important Note about GPT-5 Models:**

GPT-5 models (including `gpt-5-mini`) have **restricted parameter support**:
- ❌ No custom `temperature` (always uses default value of 1)
- ❌ No `response_format` for structured JSON output
- ❌ Different API parameters than GPT-4

The code automatically handles these limitations, but you may get better/more consistent results with `gpt-4o-mini` if you experience issues.

**To use GPT-4o-mini instead**, add this to your `.env.local`:
```bash
MEDIA_SUGGESTION_MODEL=gpt-4o-mini
```

### 3. **Test the System**

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Test the flow:**
   - Click "Start Call"
   - Hold the button and ask a conceptual question, e.g.:
     - "How does JavaScript event loop work?"
     - "Explain quantum entanglement"
     - "What is photosynthesis?"
   - Release the button
   - Watch the persona respond while images appear in the left panel

3. **Verify images are loading:**
   - Check browser console for media fetch logs
   - Images should appear within 2-3 seconds
   - If no images appear, check the troubleshooting section below

## Architecture Details

### Media Item Structure

```typescript
interface MediaItem {
  id: string;                  // Unique identifier
  imageUrl: string;            // Full-size image URL
  caption: string;             // Short description (shown below image)
  sourceUrl?: string;          // Link to original source
  attribution?: string;        // Photo credit (e.g., "Photo by John Doe on Unsplash")
  originalQuery?: string;      // Search query used
  width?: number;              // Original dimensions
  height?: number;
}
```

### State Management

Media state is managed in Zustand store (`lib/store.ts`):

```typescript
interface CallState {
  // ... other state
  mediaItems: MediaItem[];      // Current media items
  isMediaLoading: boolean;      // Loading state
  mediaError: string | null;    // Error message if fetch fails
}
```

### Trigger Logic

The system triggers media fetches at two points:

1. **Preview Fetch** (Early)
   - Triggers after first complete sentence
   - Minimum 80 characters
   - Must contain sentence-ending punctuation (. ! ?)
   - Only triggers once per response

2. **Final Fetch** (Complete)
   - Triggers when response is complete
   - Updates/refines images if response changed significantly
   - Minimum 80 new characters since last fetch

### Caching & Performance

- **Deduplication**: Same image URLs are filtered out
- **Parallel Requests**: Multiple search queries run concurrently
- **Graceful Degradation**: If one provider fails, tries the next
- **Timeout Handling**: Requests fail gracefully without blocking UI

## Troubleshooting

### No Images Appear

**Check API Keys:**
```bash
# Verify keys are set (without revealing values)
echo $UNSPLASH_ACCESS_KEY | head -c 10
```

**Check Browser Console:**
Look for errors like:
- `401 Unauthorized` → Invalid API key
- `403 Forbidden` → Rate limit exceeded
- `CORS error` → Next.js image domain not configured

**Check Server Logs:**
```bash
# In your terminal running npm run dev
[Media Suggestions] Generating search queries...
[Media Suggestions] Generated 2 search queries: [...]
[Media Suggestions] Fetched 3 media items
```

### Images Load Slowly

**Possible causes:**
1. **Network latency**: Image providers are external services
2. **LLM processing time**: gpt-5-mini takes 1-2 seconds to generate queries
3. **Image resolution**: Unsplash serves high-quality images (can be large)

**Solutions:**
- Images are fetched in parallel with audio playback
- Loading spinner shows while fetching
- Consider using Pexels as primary (faster but lower quality)

### Rate Limiting

**Unsplash Free Tier:**
- 50 requests per hour
- Resets hourly
- Consider upgrading for production use

**OpenAI:**
- Uses your existing API quota
- Each media fetch = 1 LLM call (~100-300 tokens)
- Approximately $0.0001-0.0003 per fetch with gpt-5-mini

### CORS or Image Loading Errors

**Verify Next.js Configuration:**

Check `next.config.ts` includes:
```typescript
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: 'images.unsplash.com',
    },
    {
      protocol: 'https',
      hostname: '*.pexels.com',
    },
  ],
}
```

**Restart dev server after config changes:**
```bash
# Stop server (Ctrl+C) and restart
npm run dev
```

## Customization

### Adding More Image Providers

Edit `lib/image-search.ts` and add a new search function:

```typescript
async function searchNewProvider(
  query: string,
  perPage: number = 1,
): Promise<MediaItem[]> {
  const API_KEY = process.env.NEW_PROVIDER_API_KEY;

  if (!API_KEY) {
    return [];
  }

  // Implement API call here
  // ...

  return mediaItems;
}

// Then add to providers array in searchImages()
providers = ['unsplash', 'pexels', 'newProvider']
```

### Adjusting Query Generation

Edit the `SYSTEM_PROMPT` in `lib/media-suggestions.ts` to change how queries are generated:

```typescript
const SYSTEM_PROMPT = `Your custom instructions here...`;
```

### Changing Display Behavior

Modify `CallInterface.tsx` trigger thresholds:

```typescript
// Line ~356: Change preview trigger threshold
if (trimmedResponse.length < 80) {  // Change this number
  return;
}

// Line ~364: Change final fetch threshold
const delta = trimmedResponse.length - lastMediaRequestLengthRef.current;
if (delta < 80 && ...) {  // Change this number
  return;
}
```

## Performance Metrics

**Typical Timings:**
- LLM query generation: 1-2 seconds
- Image API fetch: 0.5-1 second per provider
- Total media fetch: 2-3 seconds (parallel)

**Resource Usage:**
- Memory: ~5-10 MB per set of images (cached in browser)
- Network: ~500 KB - 2 MB per image fetch
- API Calls: 1 LLM call + 2-3 image provider calls per user question

## Future Enhancements

Potential improvements:
- [ ] Server-side image caching (Redis)
- [ ] Pre-fetch based on common topics
- [ ] Image generation fallback (DALL-E) for rare concepts
- [ ] User preference for image style/type
- [ ] Analytics on image relevance
- [ ] A/B testing different LLM prompts

## Support

If you encounter issues:
1. Check this README's troubleshooting section
2. Verify all API keys are correct
3. Check browser and server console logs
4. Ensure Next.js config includes image domains
5. Try restarting the dev server

For bugs or feature requests, create an issue with:
- Error messages (console + server logs)
- Steps to reproduce
- Expected vs actual behavior
