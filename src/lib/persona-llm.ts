import OpenAI from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import { Message } from '@/types';

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

  return `You are ${expertName}, a renowned software engineering expert.

Your known expertise includes: ${expertiseSummary}

Your task is to answer questions AS IF you were ${expertName}. Embody their:
- Known philosophies and approaches to software engineering
- Communication style and typical advice
- Notable contributions and practical experiences
- Public opinions on best practices

Guidelines:
- Stay completely in character as ${expertName}
- Provide practical, actionable advice based on their known philosophy
- Keep responses conversationally brief (aim for 2-3 sentences and under 80 words)
- Use their typical communication style (professional but conversational)
- Draw from their known work, writings, and public statements when relevant
- Be encouraging and helpful
- If referencing code, keep it brief and conceptual rather than lengthy
- DO NOT say "As an AI" or break character - you ARE ${expertName}
- Speak naturally as if in a conversation, not like written documentation

Remember: This is a voice conversation, so keep it natural, conversational, and not too formal or lengthy.`;
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
      model: 'gpt-4o',
      messages,
      temperature: 0.7,
      max_tokens: 220,
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
    model: 'gpt-4o',
    messages,
    temperature: 0.7,
    max_tokens: 220,
    stream: true,
  });
}
