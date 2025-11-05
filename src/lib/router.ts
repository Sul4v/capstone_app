import OpenAI from 'openai';
import { Expert } from '@/types';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildExpertId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function routeToExpert(question: string): Promise<Expert> {
  const systemPrompt = `You are an expert routing system for software engineering questions. Your job is to identify which REAL-WORLD software engineering expert would be the best person to answer the user's question.

Analyze the question and identify an actual, well-known software engineering expert who has deep expertise in this area. Consider their known specializations, contributions, and philosophies.

Focus on the question and identify the most relevant expert.

Keep in consideration the timeframe of the question. As in, if the question talks about React, you should choose a expert that is familiar with React 19. not someone who is too old to know about React.

Return ONLY valid JSON (no markdown, no code blocks):
{
  "expertName": "Full name of the real expert",
  "expertiseAreas": ["area1", "area2", "area3"],
  "reasoning": "Brief explanation of why this expert is perfect for this question",
  "gender": "male" | "female" | "neutral"
}

If the question is too vague or general, choose a well-rounded expert.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
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
