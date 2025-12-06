import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { transcribeAudio } from '@/lib/deepgram';
import { routeToExpert } from '@/lib/router';
import { streamExpertResponse } from '@/lib/persona-llm';
import { textToSpeechStream } from '@/lib/elevenlabs-sdk';
import {
  getSession,
  setSessionExpert,
  addMessageToSession,
  createSession,
} from '@/lib/sessions';
import { saveInteraction } from '@/lib/db';
import { Expert, Message } from '@/types';

export const runtime = 'nodejs';

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

type StreamPayload =
  | {
    type: 'metadata';
    transcript: string;
    expert: {
      name: string;
      expertiseAreas?: string[];
      reasoning?: string;
    };
  }
  | { type: 'text_delta'; delta: string }
  | { type: 'audio_chunk'; index: number; text: string; audioBase64: string }
  | { type: 'complete'; text: string; processingTimeMs: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

function enqueuePayload(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: StreamPayload,
) {
  const json = JSON.stringify(payload);
  controller.enqueue(new TextEncoder().encode(json + '\n'));
}

export async function POST(request: Request) {
  let sessionId: string | null = null;
  const startTime = Date.now();
  try {
    const contentType = request.headers.get('content-type') ?? '';
    let message: string | null = null;
    let audioBase64: string | null = null;

    sessionId = request.headers.get('x-session-id');
    const userName = request.headers.get('x-user-name');
    if (!sessionId) {
      sessionId = randomUUID();
      createSession(sessionId);
      console.log(`[Session ${sessionId}] No session provided, created new session`);
    }
    console.log(`[Session ${sessionId}] Processing message request (user: ${userName || 'anonymous'})`);

    if (contentType.includes('application/json')) {
      const json = await request.json();
      message = json.message ?? null;
      audioBase64 = json.audioBase64 ?? null;
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      message = formData.get('message') as string | null;
      const audioFile = formData.get('audio') as File | null;
      if (audioFile) {
        const arrayBuffer = await audioFile.arrayBuffer();
        audioBase64 = Buffer.from(arrayBuffer).toString('base64');
      }
    } else if (
      contentType.includes('audio/') ||
      contentType.includes('application/octet-stream')
    ) {
      const arrayBuffer = await request.arrayBuffer();
      audioBase64 = Buffer.from(arrayBuffer).toString('base64');
    }

    if (!message && !audioBase64) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either message or audio is required.',
        },
        { status: 400 },
      );
    }

    let transcript: string;
    if (!message && audioBase64) {
      console.log(`[Session ${sessionId}] Step 1: Transcribing audio...`);
      const transcriptionStart = Date.now();
      // Convert base64 to Blob for Deepgram
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const audioBlob = new Blob([audioBuffer], { type: 'audio/webm' });
      transcript = await transcribeAudio(audioBlob);
      console.log(
        `[Session ${sessionId}] Transcription took ${Date.now() - transcriptionStart}ms: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`,
      );
    } else {
      transcript = message!;
      console.log(
        `[Session ${sessionId}] Using text message: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`,
      );
    }

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unable to process audio. Please try again.',
        },
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

    let session = getSession(sessionId);
    if (!session) {
      createSession(sessionId);
      session = getSession(sessionId);
    }
    if (!session) {
      throw new Error('Failed to initialize session');
    }

    console.log(`[Session ${sessionId}] Step 2: Routing to expert...`);
    const routeStart = Date.now();
    const previousExpertName = session.expert?.name ?? undefined;
    const routedExpert = await routeToExpert(transcript, {
      conversationHistory: session.conversationHistory,
      currentExpertName: previousExpertName,
    });

    const expert: Expert = routedExpert;
    setSessionExpert(sessionId, expert);

    console.log(
      `[Session ${sessionId}] Routing took ${Date.now() - routeStart}ms`,
    );

    if (!previousExpertName) {
      console.log(
        `[Session ${sessionId}] Selected expert: ${expert.name} (voice: ${expert.voiceId}) - ${expert.reasoning}`,
      );
    } else if (previousExpertName === expert.name) {
      console.log(
        `[Session ${sessionId}] Continuing with expert: ${expert.name} (voice: ${expert.voiceId}) - ${expert.reasoning}`,
      );
    } else {
      console.log(
        `[Session ${sessionId}] Switched expert from ${previousExpertName} to ${expert.name} (voice: ${expert.voiceId}) - ${expert.reasoning}`,
      );
    }

    if (!expert) {
      throw new Error('Unable to determine expert persona for this session.');
    }

    const voiceId = resolveVoiceId(expert);

    const stream = new ReadableStream<Uint8Array>({
      start: async controller => {
        const chunkStart = Date.now();
        let fullResponse = '';
        let llmDuration = 0;

        try {
          enqueuePayload(controller, {
            type: 'metadata',
            transcript,
            expert: {
              name: expert.name,
              expertiseAreas: expert.expertiseAreas,
              reasoning: expert.reasoning,
            },
          });

          console.log(
            `[Session ${sessionId}] Step 3: Streaming expert response as ${expert.name}...`,
          );
          const llmStreamStart = Date.now();
          const llmStream = await streamExpertResponse(
            transcript,
            expert.name,
            expert.expertiseAreas ?? [],
            session.conversationHistory,
          );

          // Stream text to client as LLM generates it
          for await (const part of llmStream) {
            const delta = part.choices?.[0]?.delta?.content ?? '';
            if (!delta) {
              continue;
            }
            enqueuePayload(controller, { type: 'text_delta', delta });
            fullResponse += delta;
          }
          llmDuration = Date.now() - llmStreamStart;

          console.log(
            `[Session ${sessionId}] LLM response complete in ${llmDuration}ms. Starting TTS...`,
          );

          // Now convert the full text to speech using ElevenLabs SDK
          // The SDK has built-in retry logic and better error handling
          if (fullResponse.trim()) {
            try {
              const ttsStart = Date.now();
              const audioStream = await textToSpeechStream({
                voiceId,
                text: fullResponse.trim(),
                modelId: 'eleven_flash_v2_5',
                voiceSettings: {
                  stability: 0.5,
                  similarityBoost: 0.75,
                },
              });

              // Read audio stream and send chunks to client
              const reader = audioStream.getReader();
              let chunkIndex = 0;
              let leftover: Uint8Array | null = null;

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (value) {
                  let data = value;

                  // Handle leftover bytes from previous chunk
                  if (leftover) {
                    const combined = new Uint8Array(leftover.length + value.length);
                    combined.set(leftover);
                    combined.set(value, leftover.length);
                    data = combined;
                    leftover = null;
                  }

                  // Ensure data length is even (multiple of 2 for 16-bit PCM)
                  if (data.length % 2 !== 0) {
                    leftover = data.slice(data.length - 1);
                    data = data.slice(0, data.length - 1);
                  }

                  if (data.length > 0) {
                    chunkIndex++;
                    const audioBase64 = Buffer.from(data).toString('base64');
                    enqueuePayload(controller, {
                      type: 'audio_chunk',
                      index: chunkIndex,
                      text: '', // Text was already streamed
                      audioBase64,
                    });
                  }
                }
              }

              console.log(
                `[Session ${sessionId}] TTS complete in ${Date.now() - ttsStart}ms (${chunkIndex} chunks)`,
              );
            } catch (ttsError) {
              // Log TTS error but don't fail the whole request
              // The text response has already been sent
              console.error(
                `[Session ${sessionId}] TTS error (non-fatal):`,
                ttsError instanceof Error ? ttsError.message : ttsError,
              );
              // Notify client that audio is unavailable
              enqueuePayload(controller, {
                type: 'error',
                message: `Audio generation failed: ${ttsError instanceof Error ? ttsError.message : 'Unknown error'}. Text response is still available.`,
              });
            }
          }

          const expertMessage: Message = {
            id: randomUUID(),
            role: 'expert',
            content: fullResponse.trim(),
            timestamp: new Date(),
            expertName: expert.name,
          };
          addMessageToSession(sessionId!, expertMessage);

          const processingTime = Date.now() - startTime;
          enqueuePayload(controller, {
            type: 'complete',
            text: fullResponse.trim(),
            processingTimeMs: processingTime,
          });

          console.log(
            `[Session ${sessionId}] Streaming completed in ${processingTime}ms (LLM: ${llmDuration}ms)`,
          );

          // Save interaction to database (fire and forget)
          saveInteraction(sessionId!, transcript, fullResponse.trim(), expert.name, userName || undefined).catch(err => {
            console.error(`[Session ${sessionId}] Failed to save interaction in background:`, err);
          });
        } catch (error) {
          console.error('Error streaming call message:', error);
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown error encountered.';
          enqueuePayload(controller, {
            type: 'error',
            message,
          });
        } finally {
          enqueuePayload(controller, { type: 'done' });
          console.log(
            `[Session ${sessionId}] Stream finalized after ${Date.now() - chunkStart}ms`,
          );
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
      },
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
