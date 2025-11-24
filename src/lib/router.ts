import OpenAI from 'openai';
import { Expert, Message } from '@/types';
import { ROUTER_SYSTEM_PROMPT } from '@/lib/prompts';
import { MODELS } from '@/lib/models';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface RoutingContext {
  conversationHistory?: Message[];
  currentExpertName?: string;
}

const HISTORY_SNIPPET_LIMIT = 6;

function formatHistoryEntry(message: Message): string {
  const roleLabel =
    message.role === 'user'
      ? 'User'
      : message.role === 'expert'
        ? 'Expert'
        : message.role === 'assistant'
          ? 'Assistant'
          : 'System';

  const personaSuffix = message.expertName ? ` (${message.expertName})` : '';
  const text = message.content.trim().replace(/\s+/g, ' ');
  return `${roleLabel}${personaSuffix}: ${text}`;
}

function buildHistoryExcerpt(history: Message[]): string {
  if (!history.length) {
    return '';
  }

  const recent = history.slice(-HISTORY_SNIPPET_LIMIT);
  return recent.map(formatHistoryEntry).join('\n');
}

function buildExpertId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function routeToExpert(
  question: string,
  context: RoutingContext = {},
): Promise<Expert> {
  const systemPrompt = ROUTER_SYSTEM_PROMPT;

  const historyExcerpt = buildHistoryExcerpt(context.conversationHistory ?? []);
  const historySection = historyExcerpt
    ? `Conversation history:\n${historyExcerpt}`
    : 'No conversation history yet.';
  const currentExpertLine = context.currentExpertName
    ? `Current expert: ${context.currentExpertName}`
    : 'No expert is currently assigned.';

  const userPrompt = [
    historySection,
    currentExpertLine,
    `Current question: ${question}`,
  ].join('\n\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from router');

    const result = JSON.parse(content) as {
      expertName?: string;
      expertiseAreas?: unknown;
      reasoning?: string;
      gender?: string;
    };

    if (typeof result.expertName !== 'string' || !result.expertName.trim()) {
      throw new Error('Router returned invalid expert name');
    }

    const expertiseAreas = Array.isArray(result.expertiseAreas)
      ? (result.expertiseAreas.filter(
        area => typeof area === 'string' && area.trim(),
      ) as string[])
      : [];

    const reasoning =
      typeof result.reasoning === 'string' && result.reasoning.trim()
        ? result.reasoning
        : 'Expert selected based on routing heuristics.';

    const gender =
      result.gender && ['male', 'female', 'neutral'].includes(result.gender)
        ? (result.gender as 'male' | 'female' | 'neutral')
        : ('unknown' as const);

    return {
      id: buildExpertId(result.expertName),
      name: result.expertName,
      title: '',
      expertiseAreas: expertiseAreas.length ? expertiseAreas : ['software engineering'],
      description: reasoning,
      reasoning,
      gender,
    };
  } catch (error) {
    console.error('Error routing to expert:', error);
    return {
      id: 'martin-fowler',
      name: 'Martin Fowler',
      title: 'Author and Chief Scientist at Thoughtworks',
      expertiseAreas: ['software architecture', 'design patterns', 'refactoring'],
      description: 'Default expert for general software engineering questions',
      reasoning: 'Default expert for general software engineering questions',
      gender: 'male',
    };
  }
}
