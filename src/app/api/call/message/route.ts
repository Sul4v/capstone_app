import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { transcribeAudio } from '@/lib/deepgram';
import { routeToExpert } from '@/lib/router';
import { streamExpertResponse } from '@/lib/persona-llm';
import {
  createElevenLabsRealtimeStream,
  type ElevenLabsRealtimeStream,
} from '@/lib/elevenlabs-stream';
import {
  getSession,
  setSessionExpert,
  addMessageToSession,
  createSession,
} from '@/lib/sessions';
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

const textEncoder = new TextEncoder();

function enqueuePayload(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: StreamPayload,
): void {
  try {
    controller.enqueue(textEncoder.encode(`${JSON.stringify(payload)}\n`));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown');

    if (
      message.includes('Controller is already closed') ||
      message.includes('closed')
    ) {
      // Stream is already done/closed, ignore additional payloads.
      return;
    }

    throw error;
  }
}

function extractChunks(buffer: string): {
  ready: string[];
  remainder: string;
} {
  const ready: string[] = [];
  let start = 0;

  for (let i = 0; i < buffer.length; i += 1) {
    const char = buffer[i];
    if (char === '.' || char === '!' || char === '?') {
      const nextChar = buffer[i + 1];
      if (!nextChar || /\s/.test(nextChar)) {
        const sentence = buffer.slice(start, i + 1).trim();
        if (sentence) {
          ready.push(sentence);
        }
        start = i + 1;
        while (start < buffer.length && /\s/.test(buffer[start])) {
          start += 1;
        }
        i = start - 1;
      }
    }
  }

  return {
    ready,
    remainder: buffer.slice(start),
  };
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

    let session = getSession(sessionId);
    if (!session) {
      console.warn(
        `[Session ${sessionId}] Session not found (likely due to server restart). Recreating...`,
      );
      session = createSession(sessionId);
    }

    console.log(`[Session ${sessionId}] Step 1: Transcribing audio...`);
    const transcribeStart = Date.now();
    const transcript = await transcribeAudio(audioFile);
    console.log(
      `[Session ${sessionId}] Transcription took ${Date.now() - transcribeStart
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
    const previousExpertName = expert?.name;
    const routeStart = Date.now();
    const routedExpert = await routeToExpert(transcript, {
      conversationHistory: session.conversationHistory,
      currentExpertName: previousExpertName,
    });
    const voiceIdFromRouter = resolveVoiceId(routedExpert);
    expert = { ...routedExpert, voiceId: voiceIdFromRouter };
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
        const queueStartTime = Date.now();
        let fullResponse = '';
        let buffer = '';
        let chunkIndex = 0;
        let llmDuration = 0;
        let pendingChunk = '';
        let flushTimeout: NodeJS.Timeout | null = null;
        let ttsClosed = false;
        let ttsFinal = false;
        let ttsResolve: (() => void) | null = null;
        const ttsCompleted = new Promise<void>(resolve => {
          ttsResolve = resolve;
        });
        const pendingChunkTexts: Array<{ index: number; text: string }> = [];
        let nextChunkIndex = 0;

        const CHAR_THRESHOLD_START = 50; // Fast start
        const CHAR_THRESHOLD_STABLE = 150; // Stable playback
        const WORD_THRESHOLD = 24;
        const CHUNK_DELAY_MS = 220;

        let streamingError: string | null = null;
        let hasStreamedAudio = false;
        let ttsStream: ElevenLabsRealtimeStream | null = null;
        let isFirstChunk = true;

        ttsStream = await createElevenLabsRealtimeStream(
          {
            voiceId,
            modelId: 'eleven_flash_v2_5',
            voiceSettings: {
              stability: 0.5,
              similarity_boost: 0.75,
              use_speaker_boost: false,
            },
            generationConfig: {
              chunk_length_schedule: [80, 120, 180, 240],
            },
          },
          {
            onAudio: audioBase64 => {
              chunkIndex += 1;
              const queuedChunk = pendingChunkTexts.length ? pendingChunkTexts.shift() : null;
              const chunkText = queuedChunk?.text ?? '';
              enqueuePayload(controller, {
                type: 'audio_chunk',
                index: chunkIndex,
                text: chunkText,
                audioBase64,
              });
              hasStreamedAudio = true;
            },
            onFinal: () => {
              ttsFinal = true;
              if (!ttsClosed) {
                ttsResolve?.();
              }
            },
            onError: error => {
              if (
                error.message?.includes('input_timeout_exceeded') &&
                hasStreamedAudio
              ) {
                console.warn(
                  `[Session ${sessionId}] ElevenLabs stream reported input timeout after audio streamed. Treating as graceful completion.`,
                );
                return;
              }
              streamingError = error.message;
            },
            onClose: () => {
              ttsClosed = true;
              ttsResolve?.();
            },
          },
        );

        const clearFlushTimeout = () => {
          if (flushTimeout) {
            clearTimeout(flushTimeout);
            flushTimeout = null;
          }
        };

        const flushPendingChunk = () => {
          const chunkToSend = pendingChunk.trim();
          if (chunkToSend) {
            nextChunkIndex += 1;
            pendingChunkTexts.push({
              index: nextChunkIndex,
              text: chunkToSend,
            });
            ttsStream?.sendText(chunkToSend, { flush: true });
            pendingChunk = '';
            isFirstChunk = false; // Switch to stable threshold after first flush
          }
          clearFlushTimeout();
        };

        const shouldFlush = (chunk: string): boolean => {
          const threshold = isFirstChunk ? CHAR_THRESHOLD_START : CHAR_THRESHOLD_STABLE;

          if (chunk.length >= threshold) {
            return true;
          }
          const wordCount = chunk.split(/\s+/).filter(Boolean).length;
          return wordCount >= WORD_THRESHOLD;
        };

        const appendToPending = (sentence: string) => {
          pendingChunk = pendingChunk
            ? `${pendingChunk.trim()} ${sentence.trim()}`
            : sentence.trim();

          if (shouldFlush(pendingChunk)) {
            flushPendingChunk();
            return;
          }

          clearFlushTimeout();
          flushTimeout = setTimeout(() => {
            flushPendingChunk();
          }, CHUNK_DELAY_MS);
        };

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

          for await (const part of llmStream) {
            const delta = part.choices?.[0]?.delta?.content ?? '';
            if (!delta) {
              continue;
            }
            enqueuePayload(controller, { type: 'text_delta', delta });
            fullResponse += delta;
            buffer += delta;

            const { ready, remainder } = extractChunks(buffer);
            ready.forEach(sentence => appendToPending(sentence));
            buffer = remainder;
          }
          llmDuration = Date.now() - llmStreamStart;

          if (buffer.trim()) {
            appendToPending(buffer);
            buffer = '';
          }

          flushPendingChunk();

          ttsStream?.end();
          await ttsCompleted;

          if (streamingError) {
            throw new Error(streamingError);
          }

          const expertMessage: Message = {
            id: randomUUID(),
            role: 'expert',
            content: fullResponse.trim(),
            timestamp: new Date(),
            expertName: expert.name,
          };
          addMessageToSession(sessionId, expertMessage);

          const processingTime = Date.now() - startTime;
          enqueuePayload(controller, {
            type: 'complete',
            text: fullResponse.trim(),
            processingTimeMs: processingTime,
          });

          console.log(
            `[Session ${sessionId}] Streaming completed in ${processingTime}ms (LLM: ${llmDuration}ms, total chunks: ${chunkIndex})`,
          );
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
          if (!ttsFinal) {
            ttsStream?.close();
          }
          enqueuePayload(controller, { type: 'done' });
          console.log(
            `[Session ${sessionId}] Stream finalized after ${Date.now() - chunkStart
            }ms (queue start: ${queueStartTime})`,
          );
          controller.close();
          clearFlushTimeout();
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
