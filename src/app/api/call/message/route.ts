import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { transcribeAudio } from '@/lib/deepgram';
import { routeToExpert } from '@/lib/router';
import { getExpertResponse } from '@/lib/persona-llm';
import { generateSpeech } from '@/lib/elevenlabs';
import {
  getSession,
  setSessionExpert,
  addMessageToSession,
} from '@/lib/sessions';
import { Expert, Message } from '@/types';

const DEFAULT_EXPERT_VOICE_ID =
  process.env.ELEVENLABS_EXPERT_VOICE_ID ?? 'EXAVITQu4vr4xnSDxMaL';
const MALE_EXPERT_VOICE_ID =
  process.env.ELEVENLABS_MALE_EXPERT_VOICE_ID ?? DEFAULT_EXPERT_VOICE_ID;
const FEMALE_EXPERT_VOICE_ID =
  process.env.ELEVENLABS_FEMALE_EXPERT_VOICE_ID ?? DEFAULT_EXPERT_VOICE_ID;
const NEUTRAL_EXPERT_VOICE_ID =
  process.env.ELEVENLABS_NEUTRAL_EXPERT_VOICE_ID ?? DEFAULT_EXPERT_VOICE_ID;

function resolveVoiceId(expert: Expert): string {
  if (expert.voiceId) {
    return expert.voiceId;
  }

  switch (expert.gender) {
    case 'female':
      return FEMALE_EXPERT_VOICE_ID;
    case 'male':
      return MALE_EXPERT_VOICE_ID;
    case 'neutral':
      return NEUTRAL_EXPERT_VOICE_ID;
    default:
      return DEFAULT_EXPERT_VOICE_ID;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    const formData = await request.formData();
    const sessionId = formData.get('sessionId');
    const audioFile = formData.get('audio');

    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing sessionId.' },
        { status: 400 },
      );
    }

    if (!(audioFile instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Missing audio file.' },
        { status: 400 },
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Invalid session.' },
        { status: 404 },
      );
    }

    console.log(`[Session ${sessionId}] Step 1: Transcribing audio...`);
    const transcribeStart = Date.now();
    const transcript = await transcribeAudio(audioFile);
    console.log(
      `[Session ${sessionId}] Transcription took ${
        Date.now() - transcribeStart
      }ms`,
    );

    if (!transcript?.trim()) {
      return NextResponse.json(
        { success: false, error: 'No speech detected.' },
        { status: 400 },
      );
    }

    const userMessage: Message = {
      id: randomUUID(),
      role: 'user',
      content: transcript,
      timestamp: new Date(),
    };
    addMessageToSession(sessionId, userMessage);

    let expert = session.expert;

    if (!expert) {
      console.log(
        `[Session ${sessionId}] Step 2: Routing to expert (first question)...`,
      );
      const routeStart = Date.now();
      const routedExpert = await routeToExpert(transcript);
      const voiceId = resolveVoiceId(routedExpert);
      expert = { ...routedExpert, voiceId };
      setSessionExpert(sessionId, expert);
      console.log(
        `[Session ${sessionId}] Routing took ${Date.now() - routeStart}ms`,
      );
      console.log(
        `[Session ${sessionId}] Selected expert: ${expert.name} (voice: ${expert.voiceId}) - ${expert.reasoning}`,
      );
    } else {
      if (!expert.voiceId) {
        const assignedVoice = resolveVoiceId(expert);
        expert = { ...expert, voiceId: assignedVoice };
        setSessionExpert(sessionId, expert);
      }
      console.log(
        `[Session ${sessionId}] Using existing expert: ${expert.name} (voice: ${expert.voiceId}) (follow-up question)`,
      );
    }

    if (!expert) {
      throw new Error('Unable to determine expert persona for this session.');
    }

    console.log(
      `[Session ${sessionId}] Step 3: Generating expert response as ${expert.name}...`,
    );
    const llmStart = Date.now();
    const responseText = await getExpertResponse(
      transcript,
      expert.name,
      expert.expertiseAreas,
      session.conversationHistory,
    );
    console.log(
      `[Session ${sessionId}] LLM response took ${Date.now() - llmStart}ms`,
    );

    const expertMessage: Message = {
      id: randomUUID(),
      role: 'expert',
      content: responseText,
      timestamp: new Date(),
      expertName: expert.name,
    };
    addMessageToSession(sessionId, expertMessage);

    console.log(
      `[Session ${sessionId}] Step 4: Converting expert response to speech...`,
    );
    const ttsStart = Date.now();
    const voiceId = resolveVoiceId(expert);
    const audioBuffer = await generateSpeech(responseText, voiceId);
    const audioBase64 = audioBuffer.toString('base64');
    console.log(
      `[Session ${sessionId}] TTS took ${Date.now() - ttsStart}ms (voice: ${voiceId})`,
    );

    const totalTime = Date.now() - startTime;
    console.log(`[Session ${sessionId}] Total processing time: ${totalTime}ms`);

    return NextResponse.json({
      success: true,
      transcript,
      expert: {
        name: expert.name,
        expertiseAreas: expert.expertiseAreas,
        reasoning: expert.reasoning,
      },
      responseText,
      audioBase64,
      processingTimeMs: totalTime,
    });
  } catch (error) {
    console.error('Error processing call message:', error);
    const message =
      error instanceof Error ? error.message : 'Unknown error encountered.';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process message.',
        details: message,
      },
      { status: 500 },
    );
  }
}
