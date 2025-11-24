import OpenAI from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { Message } from '@/types';
import { PERSONA_SYSTEM_PROMPT } from '@/lib/prompts';
import { MODELS } from '@/lib/models';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function buildSystemPrompt(expertName: string, expertiseAreas: string[]): string {
  const expertiseSummary =
    Array.isArray(expertiseAreas) && expertiseAreas.length > 0
      ? expertiseAreas.join(', ')
      : 'software engineering';

  return PERSONA_SYSTEM_PROMPT(expertName, expertiseSummary);
}

export function buildExpertMessages(
  question: string,
  expertName: string,
  expertiseAreas: string[],
  conversationHistory: Message[] = [],
): ChatMessage[] {
  if (!question?.trim()) {
    throw new Error('Question is required to get an expert response.');
  }

  if (!expertName?.trim()) {
    throw new Error('Expert name is required to get an expert response.');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(expertName, expertiseAreas) },
  ];

  const recentHistory = conversationHistory.slice(-5);
  recentHistory.forEach(historyMessage => {
    if (historyMessage.role === 'user') {
      messages.push({ role: 'user', content: historyMessage.content });
    } else if (
      historyMessage.role === 'assistant' ||
      historyMessage.role === 'expert'
    ) {
      messages.push({ role: 'assistant', content: historyMessage.content });
    }
  });

  messages.push({ role: 'user', content: question });

  return messages;
}

export async function getExpertResponse(
  question: string,
  expertName: string,
  expertiseAreas: string[],
  conversationHistory: Message[] = [],
): Promise<string> {
  try {
    const messages = buildExpertMessages(
      question,
      expertName,
      expertiseAreas,
      conversationHistory,
    );

    const response = await openai.chat.completions.create({
      model: MODELS.PERSONA_CHAT,
      messages,
      temperature: 0.7,
      max_completion_tokens: 220,
    });

    return (
      response.choices[0]?.message?.content ??
      "I apologize, I couldn't generate a response."
    );
  } catch (error) {
    console.error('Error generating expert response:', error);
    throw error;
  }
}

export function streamExpertResponse(
  question: string,
  expertName: string,
  expertiseAreas: string[],
  conversationHistory: Message[] = [],
): Promise<AsyncIterable<ChatCompletionChunk>> {
  const messages = buildExpertMessages(
    question,
    expertName,
    expertiseAreas,
    conversationHistory,
  );

  return openai.chat.completions.create({
    model: MODELS.PERSONA_CHAT,
    messages,
    temperature: 0.7,
    max_completion_tokens: 220,
    stream: true,
  });
}
