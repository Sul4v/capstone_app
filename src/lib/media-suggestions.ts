/**
 * Media Suggestions Helper
 *
 * Uses OpenAI's gpt-5-mini model to analyze persona responses and generate
 * relevant image search queries with short captions for visual aids.
 */

import OpenAI from 'openai';

export interface MediaSuggestion {
  query: string;
  caption: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MEDIA_SUGGESTION_MODEL = process.env.MEDIA_SUGGESTION_MODEL || 'gpt-5-mini';

const SYSTEM_PROMPT = `You are a visual content curator for an educational call assistant. Your job is to suggest relevant image search queries based on the conversation context.

Given a user's question and the expert's response, generate 2-3 concise image search queries that would help visualize and reinforce the concepts being discussed.

For each query:
1. The search query should be specific and likely to return relevant conceptual images
2. The caption should be brief (8-12 words max) and explain what the image illustrates
3. Focus on concepts, processes, or visual representations rather than generic stock photos

IMPORTANT: You MUST return ONLY a valid JSON array of objects with "query" and "caption" fields. Do not include any explanatory text before or after the JSON.

Example format (return exactly this structure):
[
  {
    "query": "query for an image",
    "caption": "caption for the image"
  },
  {
    "query": "query for an image",
    "caption": "caption for the image"
  }
]`;

export interface GenerateMediaSuggestionsOptions {
  transcript?: string;
  responsePreview: string;
  expertName?: string;
  expertiseAreas?: string[];
  limit?: number;
}

export async function generateMediaSuggestions(
  options: GenerateMediaSuggestionsOptions,
): Promise<MediaSuggestion[]> {
  const {
    transcript,
    responsePreview,
    expertName,
    expertiseAreas,
    limit = 3,
  } = options;

  if (!responsePreview.trim()) {
    return [];
  }

  // Build context message
  let contextMessage = '';

  if (transcript) {
    contextMessage += `User Question: ${transcript}\n\n`;
  }

  if (expertName) {
    contextMessage += `Expert: ${expertName}`;
    if (expertiseAreas && expertiseAreas.length > 0) {
      contextMessage += ` (${expertiseAreas.join(', ')})`;
    }
    contextMessage += '\n\n';
  }

  contextMessage += `Expert Response: ${responsePreview}`;

  try {
    // GPT-5 models don't support custom temperature, max_tokens, or response_format
    // They use default temperature (1) and have different parameter sets
    const isGPT5Model = MEDIA_SUGGESTION_MODEL.startsWith('gpt-5');

    const completion = await openai.chat.completions.create({
      model: MEDIA_SUGGESTION_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: contextMessage },
      ],
      // Only include these parameters for non-GPT-5 models
      ...(isGPT5Model
        ? {}
        : {
            temperature: 0.7,
            max_completion_tokens: 500,
            response_format: { type: 'json_object' },
          }),
    });

    const responseContent = completion.choices[0]?.message?.content;

    if (!responseContent) {
      console.warn('No content in media suggestion response');
      return [];
    }

    // Parse the JSON response
    // GPT-5 might not use response_format, so we need to extract JSON from the text
    let parsed: unknown;
    try {
      // First, try to parse the entire response as JSON
      parsed = JSON.parse(responseContent);
    } catch (parseError) {
      // If that fails, try to extract JSON array from the response
      console.warn('Direct JSON parse failed, attempting to extract JSON from text');
      const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (extractError) {
          console.error('Failed to extract and parse JSON array:', extractError);
          console.error('Response content:', responseContent);
          return [];
        }
      } else {
        console.error('Failed to parse media suggestions JSON:', parseError);
        console.error('Response content:', responseContent);
        return [];
      }
    }

    // Validate and extract suggestions
    let suggestions: MediaSuggestion[] = [];

    if (Array.isArray(parsed)) {
      suggestions = parsed;
    } else if (typeof parsed === 'object' && parsed !== null) {
      // Handle case where response is wrapped in an object
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.suggestions)) {
        suggestions = obj.suggestions;
      } else if (Array.isArray(obj.items)) {
        suggestions = obj.items;
      } else if (Array.isArray(obj.queries)) {
        suggestions = obj.queries;
      }
    }

    // Validate structure and filter invalid entries
    const validSuggestions = suggestions
      .filter((item): item is MediaSuggestion => {
        return (
          typeof item === 'object' &&
          item !== null &&
          typeof (item as MediaSuggestion).query === 'string' &&
          typeof (item as MediaSuggestion).caption === 'string' &&
          (item as MediaSuggestion).query.trim().length > 0 &&
          (item as MediaSuggestion).caption.trim().length > 0
        );
      })
      .slice(0, limit);

    return validSuggestions;
  } catch (error) {
    console.error('Error generating media suggestions:', error);

    if (error instanceof Error) {
      // Log more details for debugging
      console.error('Error details:', {
        message: error.message,
        name: error.name,
      });
    }

    throw error;
  }
}
