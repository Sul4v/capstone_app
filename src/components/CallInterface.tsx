'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  startRecording,
  stopRecording,
  isAudioRecordingSupported,
  playAudio,
} from '@/lib/audio-utils';
import { Message, MediaItem } from '@/types';
import { useCallStore } from '@/lib/store';
import ExpertBadge from '@/components/ExpertBadge';
import MessageBubble from '@/components/MessageBubble';
import { StreamingAudioPlayer } from '@/lib/streaming-audio-player';

type CallStatus = 'idle' | 'listening' | 'processing' | 'speaking';

type StartCallResponse = {
  success?: boolean;
  sessionId?: string;
  greetingText?: string;
  audioBase64?: string;
  error?: string;
};

type StreamResponseMessage =
  | {
      type: 'metadata';
      transcript: string;
      expert?: {
        name: string;
        expertiseAreas?: string[];
        reasoning?: string;
      };
    }
  | { type: 'text_delta'; delta: string }
  | {
      type: 'audio_chunk';
      index: number;
      text: string;
      audioBase64: string;
    }
  | { type: 'complete'; text: string; processingTimeMs?: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

const MEDIA_CARD_PLACEHOLDERS = [
  { id: 'media-card-1', label: 'Media Slot 1' },
  { id: 'media-card-2', label: 'Media Slot 2' },
  { id: 'media-card-3', label: 'Media Slot 3' },
] as const;

const MEDIA_SWIPE_THRESHOLD_PX = 60;

function createMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

function stopRecorderStream(recorder: MediaRecorder | null) {
  if (!recorder) return;
  try {
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  } catch {
    // ignore stop errors that occur if recorder already stopped
  }
  recorder.stream.getTracks().forEach(track => track.stop());
}

export default function CallInterface() {
  const {
    sessionId,
    isActive,
    currentExpert,
    conversationHistory,
    isListening,
    isProcessing,
    isSpeaking,
    error,
    setSessionId,
    setIsActive,
    setCurrentExpert,
    addMessage,
    updateMessage,
    removeMessage,
    clearMessages,
    setIsListening,
    setIsProcessing,
    setIsSpeaking,
    setError,
    mediaItems,
    isMediaLoading,
    mediaError,
    setMediaItems,
    setIsMediaLoading,
    setMediaError,
    resetMedia,
  } = useCallStore();

  const [isBrowserSupported, setIsBrowserSupported] = useState(true);
  const [isStartLoading, setIsStartLoading] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [mediaPointerStartX, setMediaPointerStartX] = useState<number | null>(
    null,
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const playbackAbortRef = useRef<AbortController | null>(null);
  const streamingPlayerRef = useRef<StreamingAudioPlayer | null>(null);
  const isHoldingRef = useRef(false);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRequestAbortRef = useRef<AbortController | null>(null);
  const hasTriggeredMediaRef = useRef(false);
  const lastMediaRequestLengthRef = useRef(0);
  const mediaRequestInFlightRef = useRef<'preview' | 'final' | null>(null);
  const mediaContextRef = useRef<{
    transcript: string;
    responsePreview: string;
    expertName?: string;
    expertiseAreas?: string[];
  }>({
    transcript: '',
    responsePreview: '',
    expertName: undefined,
    expertiseAreas: undefined,
  });

  const callStatus: CallStatus = useMemo(() => {
    if (isProcessing) return 'processing';
    if (isSpeaking) return 'speaking';
    if (isListening) return 'listening';
    return 'idle';
  }, [isListening, isProcessing, isSpeaking]);

  useEffect(() => {
    isHoldingRef.current = isHolding;
  }, [isHolding]);

  useEffect(() => {
    setIsBrowserSupported(isAudioRecordingSupported());
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationHistory]);

  const clearErrorLater = useCallback(() => {
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }
    errorTimeoutRef.current = setTimeout(() => {
      setError(null);
    }, 5000);
  }, [setError]);

  const handleError = useCallback(
    (err: unknown, context: string) => {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : '';

      console.error(`Error in ${context}:`, err);

      let errorMessage = 'Something went wrong. Please try again.';

      if (message?.toLowerCase().includes('microphone')) {
        errorMessage =
          'Microphone permission denied. Please allow access to your microphone.';
      } else if (
        message?.toLowerCase().includes('network') ||
        message?.toLowerCase().includes('fetch')
      ) {
        errorMessage =
          'Network error. Please check your internet connection.';
      } else if (message?.includes('No speech detected')) {
        errorMessage =
          "I didn't catch that. Please speak clearly and try again.";
      } else if (context === 'transcribe' && !message) {
        errorMessage = 'Could not transcribe audio. Please try speaking again.';
      }

      setError(errorMessage);
      clearErrorLater();
    },
    [clearErrorLater, setError],
  );

  const addSystemMessage = useCallback(
    (content: string) => {
      const systemMessage: Message = {
        id: createMessageId(),
        role: 'system',
        content,
        timestamp: new Date(),
      };
      addMessage(systemMessage);
    },
    [addMessage],
  );

  const getStreamingPlayer = useCallback(() => {
    if (!streamingPlayerRef.current) {
      streamingPlayerRef.current = new StreamingAudioPlayer();
    }
    return streamingPlayerRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    if (playbackAbortRef.current) {
      playbackAbortRef.current.abort();
      playbackAbortRef.current = null;
    }
    streamingPlayerRef.current?.stop();
  }, []);

  const mediaItemCount = mediaItems.length;

  const goToNextMediaCard = useCallback(() => {
    setActiveMediaIndex(prev => {
      const total =
        mediaItemCount > 0 ? mediaItemCount : MEDIA_CARD_PLACEHOLDERS.length;
      if (total <= 0) return 0;
      return (prev + 1) % total;
    });
  }, [mediaItemCount]);

  const goToPreviousMediaCard = useCallback(() => {
    setActiveMediaIndex(prev => {
      const total =
        mediaItemCount > 0 ? mediaItemCount : MEDIA_CARD_PLACEHOLDERS.length;
      if (total <= 0) return 0;
      return (prev - 1 + total) % total;
    });
  }, [mediaItemCount]);

  const handleMediaPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary) return;

      const total =
        mediaItemCount > 0 ? mediaItemCount : MEDIA_CARD_PLACEHOLDERS.length;
      if (total <= 1) return;

      setMediaPointerStartX(event.clientX);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // setPointerCapture is not supported in some environments; ignore errors
      }
    },
    [mediaItemCount],
  );

  const handleMediaPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary) return;

      if (mediaPointerStartX === null) return;

      const total =
        mediaItemCount > 0 ? mediaItemCount : MEDIA_CARD_PLACEHOLDERS.length;
      if (total <= 1) {
        setMediaPointerStartX(null);
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // ignore if capture was never set
        }
        return;
      }

      const deltaX = event.clientX - mediaPointerStartX;

      if (Math.abs(deltaX) >= MEDIA_SWIPE_THRESHOLD_PX) {
        if (deltaX < 0) {
          goToNextMediaCard();
        } else {
          goToPreviousMediaCard();
        }
      }

      setMediaPointerStartX(null);

      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore if capture was never set
      }
    },
    [goToNextMediaCard, goToPreviousMediaCard, mediaItemCount, mediaPointerStartX],
  );

  const handleMediaPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      setMediaPointerStartX(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore if capture was never set
      }
    },
    [],
  );

  const abortPendingMediaRequest = useCallback(() => {
    if (mediaRequestAbortRef.current) {
      mediaRequestAbortRef.current.abort();
      mediaRequestAbortRef.current = null;
    }
    mediaRequestInFlightRef.current = null;
  }, []);

  const triggerMediaFetch = useCallback(
    (reason: 'preview' | 'final') => {
      const context = mediaContextRef.current;
      const trimmedResponse = context.responsePreview.trim();

      if (!trimmedResponse) {
        return;
      }

      if (reason === 'preview') {
        if (
          hasTriggeredMediaRef.current ||
          mediaRequestInFlightRef.current === 'preview'
        ) {
          return;
        }
        if (trimmedResponse.length < 80) {
          return;
        }
        if (!/[.!?]\s/.test(trimmedResponse)) {
          return;
        }
      } else if (reason === 'final') {
        const delta = trimmedResponse.length - lastMediaRequestLengthRef.current;
        if (delta < 80 && mediaRequestInFlightRef.current !== 'preview') {
          return;
        }
      }

      abortPendingMediaRequest();

      if (reason === 'preview') {
        hasTriggeredMediaRef.current = true;
      }
      mediaRequestInFlightRef.current = reason;
      setIsMediaLoading(true);
      setMediaError(null);

      const controller = new AbortController();
      mediaRequestAbortRef.current = controller;

      const payload = {
        transcript: context.transcript || undefined,
        responsePreview: trimmedResponse,
        expertName: context.expertName || undefined,
        expertiseAreas: context.expertiseAreas ?? undefined,
        limit: 5,
      };

      const run = async () => {
        try {
          const response = await fetch('/api/media/suggestions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorJson = (await response.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(
              errorJson?.error ??
                `Media suggestion request failed (${response.status}).`,
            );
          }

          const data = (await response.json()) as {
            items?: MediaItem[];
          };

          if (controller.signal.aborted) return;

          const items = Array.isArray(data.items) ? data.items : [];
          setMediaItems(items);
          lastMediaRequestLengthRef.current = trimmedResponse.length;
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error('Failed to fetch media suggestions:', error);
          setMediaItems([]);
          setMediaError(
            error instanceof Error ? error.message : 'Failed to load visuals.',
          );
        } finally {
          if (controller.signal.aborted) return;
          setIsMediaLoading(false);
          mediaRequestInFlightRef.current = null;
          mediaRequestAbortRef.current = null;
        }
      };

      run().catch(error => {
        console.error('Unexpected media fetch error:', error);
      });
    },
    [abortPendingMediaRequest, setIsMediaLoading, setMediaError, setMediaItems],
  );

  const setStatus = useCallback(
    (status: CallStatus) => {
      setIsListening(status === 'listening');
      setIsProcessing(status === 'processing');
      setIsSpeaking(status === 'speaking');
    },
    [setIsListening, setIsProcessing, setIsSpeaking],
  );

  const resetCallState = useCallback(
    (options: { clearError?: boolean } = {}) => {
      stopRecorderStream(mediaRecorderRef.current);
      mediaRecorderRef.current = null;
      sessionIdRef.current = null;
      stopPlayback();
      abortPendingMediaRequest();
      resetMedia();
      hasTriggeredMediaRef.current = false;
      lastMediaRequestLengthRef.current = 0;
      mediaContextRef.current = {
        transcript: '',
        responsePreview: '',
        expertName: undefined,
        expertiseAreas: undefined,
      };
      setStatus('idle');
      setSessionId(null);
      setIsActive(false);
      setIsHolding(false);
      isHoldingRef.current = false;
      setCurrentExpert(null);
      clearMessages();
      if (options.clearError) {
        setError(null);
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
        }
      }
    },
    [
      clearMessages,
      setCurrentExpert,
      setError,
      setIsActive,
      setSessionId,
      setStatus,
      stopPlayback,
      abortPendingMediaRequest,
      resetMedia,
    ],
  );

  const endCallSession = useCallback(async (activeSessionId: string) => {
    try {
      await fetch('/api/call/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId }),
      });
    } catch (endError) {
      console.error('Failed to end call session:', endError);
    }
  }, []);

  const requestMicrophonePermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (err) {
      handleError(err, 'microphone');
      return false;
    }
  }, [handleError]);

  const handleStartCall = useCallback(async () => {
    if (isActive || isStartLoading) return;

    setError(null);
    clearMessages();
    setCurrentExpert(null);
    setSessionId(null);
    setIsActive(false);
    setStatus('processing');
    setIsStartLoading(true);

    let newSessionId: string | null = null;

    try {
      const hasMicAccess = await requestMicrophonePermission();
      if (!hasMicAccess) {
        setStatus('idle');
        return;
      }

      const response = await fetch('/api/call/start', {
        method: 'POST',
      });

      let data: StartCallResponse = {};
      try {
        data = (await response.json()) as StartCallResponse;
      } catch {
        // Ignore JSON parse errors; handled by validation below.
      }

      if (
        !response.ok ||
        !data?.success ||
        typeof data.sessionId !== 'string' ||
        typeof data.greetingText !== 'string' ||
        typeof data.audioBase64 !== 'string'
      ) {
        const message =
          data?.error ??
          `Failed to start call (status ${response.status}).`;
        throw new Error(message);
      }

      newSessionId = data.sessionId;
      sessionIdRef.current = newSessionId;
      setSessionId(newSessionId);
      setIsActive(true);

      addSystemMessage('Call connected. Playing concierge greeting...');

      const greetingBlob = base64ToBlob(data.audioBase64, 'audio/mpeg');
      const greetingMessage: Message = {
        id: createMessageId(),
        role: 'assistant',
        content: data.greetingText,
        timestamp: new Date(),
        persona: 'concierge',
      };
      addMessage(greetingMessage);

      stopPlayback();
      setStatus('speaking');
      const greetingAbortController = new AbortController();
      playbackAbortRef.current = greetingAbortController;
      try {
        await playAudio(greetingBlob, {
          signal: greetingAbortController.signal,
        });
      } finally {
        if (playbackAbortRef.current === greetingAbortController) {
          playbackAbortRef.current = null;
        }
      }

      if (sessionIdRef.current !== newSessionId) {
        resetCallState();
        return;
      }

      const nextStatus = isHoldingRef.current ? 'listening' : 'idle';
      setStatus(nextStatus);
      if (!isHoldingRef.current) {
        addSystemMessage('Hold the button to ask your question.');
      }
    } catch (err) {
      handleError(err, 'start-call');

      if (newSessionId) {
        sessionIdRef.current = null;
        await endCallSession(newSessionId);
      }

      resetCallState({ clearError: false });
      addSystemMessage('Call failed. Please try again.');
    } finally {
      setIsStartLoading(false);
    }
  }, [
    addMessage,
    addSystemMessage,
    clearMessages,
    endCallSession,
    handleError,
    isActive,
    isStartLoading,
    requestMicrophonePermission,
    resetCallState,
    setCurrentExpert,
    setError,
    setIsActive,
    setSessionId,
    setStatus,
    stopPlayback,
  ]);

  const cancelActiveRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      stopRecorderStream(mediaRecorderRef.current);
      mediaRecorderRef.current = null;
    }
    setIsHolding(false);
    isHoldingRef.current = false;
  }, []);

  const handleStopCall = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      handleError(new Error('No active call session.'), 'end-call');
      return;
    }

    cancelActiveRecording();
    stopPlayback();

    await endCallSession(activeSessionId);

    resetCallState({ clearError: true });
  }, [
    cancelActiveRecording,
    endCallSession,
    handleError,
    resetCallState,
    stopPlayback,
  ]);

  const handleHoldStart = useCallback(async () => {
    if (
      !sessionIdRef.current ||
      !isActive ||
      callStatus === 'processing' ||
      isHolding
    ) {
      return;
    }

    try {
      setError(null);
      stopPlayback();
      setIsHolding(true);
      isHoldingRef.current = true;
      setStatus('listening');

      const recorder = await startRecording();
      mediaRecorderRef.current = recorder;
      recorder.start();

      addSystemMessage('Recording... release to send your question.');
    } catch (err) {
      handleError(err, 'recording');
      setIsHolding(false);
      isHoldingRef.current = false;
      setStatus('idle');
    }
  }, [
    addSystemMessage,
    callStatus,
    handleError,
    isActive,
    isHolding,
    setError,
    setStatus,
    stopPlayback,
  ]);

  const handleHoldCancel = useCallback(() => {
    if (!isHolding) return;

    cancelActiveRecording();
    setStatus('idle');
    addSystemMessage('Recording canceled.');
  }, [addSystemMessage, cancelActiveRecording, isHolding, setStatus]);

  const handleHoldEnd = useCallback(async () => {
    if (!isHolding) return;

    setIsHolding(false);
    isHoldingRef.current = false;

    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      setStatus('idle');
      return;
    }

    mediaRecorderRef.current = null;

    let processingMessageId: string | null = null;
    let expertMessageId: string | null = null;
    let streamingError: string | null = null;
    let fullExpertResponse = '';
    const responseAbortController = new AbortController();
    let hasStartedSpeaking = false;

    try {
      abortPendingMediaRequest();
      resetMedia();
      hasTriggeredMediaRef.current = false;
      lastMediaRequestLengthRef.current = 0;
      mediaRequestInFlightRef.current = null;
      mediaContextRef.current = {
        transcript: '',
        responsePreview: '',
        expertName: currentExpert?.name ?? undefined,
        expertiseAreas: currentExpert?.expertiseAreas ?? undefined,
      };

      setStatus('processing');
      const audioBlob = await stopRecording(recorder);

      if (!sessionIdRef.current) {
        setStatus('idle');
        return;
      }

      const formData = new FormData();
      formData.append('sessionId', sessionIdRef.current);
      formData.append('audio', audioBlob, 'question.webm');

      processingMessageId = createMessageId();
      addMessage({
        id: processingMessageId,
        role: 'system',
        content: 'Processing your question...',
        timestamp: new Date(),
      });

      stopPlayback();
      playbackAbortRef.current = responseAbortController;

      const response = await fetch('/api/call/message', {
        method: 'POST',
        body: formData,
        signal: responseAbortController.signal,
      });

      if (!response.ok) {
        let errorMessage = `Failed to process question (status ${response.status}).`;
        try {
          const errorJson = await response.json();
          if (typeof errorJson?.error === 'string') {
            errorMessage = errorJson.error;
          } else if (typeof errorJson?.details === 'string') {
            errorMessage = errorJson.details;
          }
        } catch {
          // ignore JSON parse failure and fall back to default message
        }
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!response.body || !contentType.includes('application/x-ndjson')) {
        let fallbackError = 'Unexpected response from server.';
        try {
          const fallbackJson = await response.json();
          fallbackError =
            (typeof fallbackJson?.error === 'string' && fallbackJson.error) ||
            (typeof fallbackJson?.details === 'string' && fallbackJson.details) ||
            fallbackError;
        } catch {
          // ignore parse errors
        }
        throw new Error(fallbackError);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let transcriptAdded = false;

      let playbackQueue: Promise<void> = Promise.resolve();

      const enqueuePlayback = (audioBase64: string) => {
        playbackQueue = playbackQueue.then(async () => {
          if (responseAbortController.signal.aborted) {
            return;
          }
          if (!hasStartedSpeaking) {
            hasStartedSpeaking = true;
            setStatus('speaking');
          }
          try {
            await getStreamingPlayer().enqueue(
              audioBase64,
              responseAbortController.signal,
            );
          } catch (playbackError) {
            if (
              playbackError instanceof DOMException &&
              playbackError.name === 'AbortError'
            ) {
              return;
            }
            throw playbackError;
          }
        });
      };

      const handleMetadata = (payload: Extract<StreamResponseMessage, { type: 'metadata' }>) => {
        const cleanedTranscript = (payload.transcript ?? '').trim();

        if (processingMessageId) {
          removeMessage(processingMessageId);
          processingMessageId = null;
        }

        if (cleanedTranscript) {
          addMessage({
            id: createMessageId(),
            role: 'user',
            content: cleanedTranscript,
            timestamp: new Date(),
          });
          transcriptAdded = true;
        } else {
          addSystemMessage(
            "I didn't catch anything there. Try holding the button and speaking again.",
          );
        }

        if (payload.expert) {
          setCurrentExpert({
            name: payload.expert.name,
            expertiseAreas: payload.expert.expertiseAreas,
            reasoning: payload.expert.reasoning,
          });
        }

        const expertName = payload.expert?.name ?? currentExpert?.name;
        const expertiseAreas =
          payload.expert?.expertiseAreas ?? currentExpert?.expertiseAreas;

        mediaContextRef.current.transcript = cleanedTranscript;
        mediaContextRef.current.expertName = expertName ?? undefined;
        mediaContextRef.current.expertiseAreas = expertiseAreas ?? undefined;
        mediaContextRef.current.responsePreview = '';

        expertMessageId = createMessageId();
        addMessage({
          id: expertMessageId,
          role: 'expert',
          content: '',
          timestamp: new Date(),
          expertName: payload.expert?.name ?? currentExpert?.name,
        });
      };

      const processLine = (line: string) => {
        if (!line) return;

        let payload: StreamResponseMessage;
        try {
          payload = JSON.parse(line) as StreamResponseMessage;
        } catch (parseError) {
          console.warn('Failed to parse stream payload:', parseError, line);
          return;
        }

        switch (payload.type) {
          case 'metadata':
            handleMetadata(payload);
            break;
          case 'text_delta':
            if (expertMessageId && typeof payload.delta === 'string') {
              fullExpertResponse += payload.delta;
              updateMessage(expertMessageId, message => ({
                ...message,
                content: fullExpertResponse,
                timestamp: new Date(),
              }));
            }
            break;
          case 'audio_chunk':
            if (typeof payload.audioBase64 === 'string') {
              enqueuePlayback(payload.audioBase64);
            }
            break;
          case 'complete':
            if (
              expertMessageId &&
              typeof payload.text === 'string' &&
              payload.text
            ) {
              fullExpertResponse = payload.text;
              updateMessage(expertMessageId, message => ({
                ...message,
                content: fullExpertResponse,
                timestamp: new Date(),
              }));
            }
            break;
          case 'error':
            streamingError =
              payload.message ?? 'Processing failed. Please try again.';
            break;
          case 'done':
          default:
            break;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          processLine(line);
          newlineIndex = buffer.indexOf('\n');
        }
      }

      buffer += decoder.decode();
      const remaining = buffer.trim();
      if (remaining) {
        processLine(remaining);
      }

      await playbackQueue;

      if (responseAbortController.signal.aborted) {
        return;
      }

      if (!transcriptAdded) {
        addSystemMessage(
          "I didn't catch anything there. Try holding the button and speaking again.",
        );
      }

      if (streamingError) {
        throw new Error(streamingError);
      }

      const nextStatus = isHoldingRef.current ? 'listening' : 'idle';
      setStatus(nextStatus);
    } catch (err) {
      if (
        err instanceof DOMException &&
        err.name === 'AbortError'
      ) {
        setStatus('idle');
        return;
      }

      handleError(err, 'transcribe');

      if (processingMessageId) {
        updateMessage(processingMessageId, existing => ({
          ...existing,
          role: 'system',
          content: 'Processing failed. Please try again.',
          timestamp: new Date(),
        }));
      } else {
        addSystemMessage('Processing failed. Please try again.');
      }

      if (expertMessageId) {
        updateMessage(expertMessageId, message => ({
          ...message,
          content:
            message.content ||
            'There was an issue generating a response. Please try again.',
          timestamp: new Date(),
        }));
      }

      setStatus('idle');
    } finally {
      if (playbackAbortRef.current === responseAbortController) {
        playbackAbortRef.current = null;
      }

      if (!hasStartedSpeaking && !isHoldingRef.current) {
        setStatus('idle');
      }
    }
  }, [
    addMessage,
    addSystemMessage,
    currentExpert,
    getStreamingPlayer,
    handleError,
    isHolding,
    removeMessage,
    setCurrentExpert,
    setStatus,
    stopPlayback,
    updateMessage,
  ]);

  useEffect(() => {
    return () => {
      cancelActiveRecording();
      stopPlayback();
      if (streamingPlayerRef.current) {
        streamingPlayerRef.current.dispose();
        streamingPlayerRef.current = null;
      }
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, [cancelActiveRecording, stopPlayback]);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isActive) {
        event.preventDefault();
        handleStopCall();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleStopCall, isActive]);

  if (!isBrowserSupported) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-lg">
          <p className="font-semibold">Browser Not Supported</p>
          <p className="text-sm mt-1">
            Your browser does not support audio recording. Please use a modern browser like Chrome, Firefox, or Edge.
          </p>
        </div>
      </div>
    );
  }

  const isHoldDisabled =
    !isActive ||
    callStatus === 'processing' ||
    isStartLoading;

  const statusIndicatorColor =
    callStatus === 'idle'
      ? 'bg-slate-400'
      : callStatus === 'listening'
      ? 'bg-rose-400'
      : callStatus === 'processing'
      ? 'bg-amber-400'
      : 'bg-emerald-400';

  const statusHelperText =
    callStatus === 'idle'
      ? 'Hold the button to ask your question.'
      : callStatus === 'listening'
      ? 'Listening in real time...'
      : callStatus === 'processing'
      ? 'Transcribing and analyzing your audio...'
      : "Responding with your concierge's answer.";

  const isCallButtonDisabled = !isActive && isStartLoading;
  const callButtonLabel = isActive
    ? 'End Call'
    : isStartLoading
    ? 'Starting...'
    : 'Start Call';

  const previousMediaIndex =
    (activeMediaIndex - 1 + MEDIA_CARD_PLACEHOLDERS.length) %
    MEDIA_CARD_PLACEHOLDERS.length;
  const nextMediaIndex =
    (activeMediaIndex + 1) % MEDIA_CARD_PLACEHOLDERS.length;

  return (
    <div className="relative min-h-screen bg-slate-950 text-gray-100 lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">
      {error ? (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-3 text-red-200 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{error}</span>
            <button
              onClick={() => {
                if (errorTimeoutRef.current) {
                  clearTimeout(errorTimeoutRef.current);
                }
                setError(null);
              }}
              className="text-lg leading-none text-red-200 transition-colors hover:text-red-100"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-col lg:h-full lg:min-h-0 lg:flex-row">
        <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden lg:flex lg:w-[70%] xl:w-[70%]">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-blue-600 to-sky-500" />
          <div className="absolute -top-24 -left-32 h-[28rem] w-[28rem] rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-[-12rem] right-[-6rem] h-[34rem] w-[34rem] rounded-full bg-indigo-900/50 blur-3xl" />
          <div className="absolute top-10 right-10 flex h-32 w-32 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white/80 shadow-2xl backdrop-blur">
            <span className="sr-only">Persona avatar placeholder</span>
            <svg
              className="h-14 w-14"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 12c2.485 0 4.5-2.015 4.5-4.5S14.485 3 12 3 7.5 5.015 7.5 7.5 9.515 12 12 12z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 19.25c0-2.623 3.134-4.75 7-4.75s7 2.127 7 4.75"
              />
            </svg>
          </div>
          <div className="relative z-10 flex h-full flex-col p-16 text-white">
            <div
              className="relative flex flex-1 items-center justify-center select-none cursor-grab active:cursor-grabbing touch-pan-y"
              onPointerDown={handleMediaPointerDown}
              onPointerUp={handleMediaPointerUp}
              onPointerCancel={handleMediaPointerCancel}
              role="presentation"
            >
              {MEDIA_CARD_PLACEHOLDERS.map((card, index) => {
                const isActive = index === activeMediaIndex;
                const isPrevious = index === previousMediaIndex;
                const isNext = index === nextMediaIndex;

                let positionClasses =
                  'pointer-events-none opacity-0 scale-90 translate-x-0 z-0';

                if (isActive) {
                  positionClasses =
                    'pointer-events-auto z-30 translate-x-0 scale-100 opacity-100 shadow-2xl shadow-black/40';
                } else if (isPrevious) {
                  positionClasses =
                    'pointer-events-none z-20 -translate-x-[55%] scale-[0.95] opacity-80 shadow-xl shadow-black/25';
                } else if (isNext) {
                  positionClasses =
                    'pointer-events-none z-20 translate-x-[55%] scale-[0.95] opacity-80 shadow-xl shadow-black/25';
                }

                const backgroundGradient = isActive
                  ? 'from-white/40 via-white/20 to-white/10'
                  : 'from-white/20 via-white/10 to-white/5';

                return (
                  <div
                    key={card.id}
                    className={`absolute flex h-[36rem] w-full max-w-[28rem] items-center justify-center rounded-[2.5rem] border border-white/25 bg-gradient-to-br ${backgroundGradient} backdrop-blur-xl transition-all duration-500 ease-out ${positionClasses}`}
                    aria-hidden={!isActive}
                  >
                    <span className="text-sm font-semibold uppercase tracking-[0.3em] text-white/70">
                      {card.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-16 rounded-3xl border border-white/20 bg-white/10 p-8 backdrop-blur-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/70">
                  Live status
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-3 w-3 rounded-full shadow-lg ${statusIndicatorColor}`}
                  />
                  <span className="text-sm font-medium capitalize">
                    {callStatus}
                  </span>
                </div>
              </div>
              <div className="mt-8 flex h-32 items-end justify-between gap-1">
                {[...Array(24)].map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-full bg-gradient-to-t from-white/20 via-white/60 to-white transition-all duration-300 ${
                      callStatus === 'listening' ? 'animate-wave' : ''
                    }`}
                    style={{
                      height:
                        callStatus === 'listening'
                          ? `${30 + Math.random() * 60}%`
                          : `${15 + Math.random() * 20}%`,
                      animationDelay: `${i * 0.05}s`,
                    }}
                  />
                ))}
              </div>
              <p className="mt-6 text-xs font-medium text-white/70">
                {statusHelperText}
              </p>
            </div>
          </div>
        </section>

        <section className="flex min-h-screen w-full flex-col bg-slate-900/60 backdrop-blur lg:h-full lg:w-[30%] lg:min-h-0 lg:overflow-hidden xl:w-[30%]">
          <div className="flex items-start justify-between px-6 pb-6 pt-10">
            <div>
              <h2 className="text-2xl font-semibold text-white">
                Persona Call Interface
              </h2>
              <p className="mt-1 text-sm text-gray-400">
                Start a call, then hold the button to speak with your concierge.
              </p>
            </div>
          </div>

          <div className="px-6">
            {currentExpert ? (
              <ExpertBadge expert={currentExpert} />
            ) : (
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19V6l12-2v13"
                  />
                </svg>
                Expert not assigned yet
              </div>
            )}
          </div>

          <div className="px-6 pt-6">
            <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-slate-900/40 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${statusIndicatorColor}`}
                />
                <span className="font-medium capitalize">
                  {callStatus}
                </span>
              </div>
              {sessionId ? (
                <span className="text-xs text-gray-500">
                  Session {sessionId.slice(0, 8)}...
                </span>
              ) : null}
            </div>
          </div>

          {isActive ? (
            <div className="px-6 pt-4 text-xs text-gray-400">
              <div className="grid gap-2">
                {isListening ? (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-rose-400" />
                    <span>Listening to your question...</span>
                  </div>
                ) : null}
                {isProcessing ? (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-300" />
                    <span>Processing your audio...</span>
                  </div>
                ) : null}
                {isSpeaking ? (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-300" />
                    <span>
                      {(currentExpert && currentExpert.name) || 'Assistant'} is
                      responding...
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex-1 px-6 pb-12 lg:min-h-0">
            <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 lg:min-h-0">
              <div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 py-6">
                <div className="space-y-3">
                  {conversationHistory.length === 0 ? (
                    <p className="py-12 text-center text-sm text-gray-500">
                      No messages yet. Start a call to begin the conversation.
                    </p>
                  ) : (
                    conversationHistory.map(message => (
                      <MessageBubble key={message.id} message={message} />
                    ))
                  )}
                </div>
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 w-full max-w-2xl -translate-x-1/2 px-4 lg:left-[35%] xl:left-[35%]">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-3 rounded-full border border-white/20 bg-white/40 px-4 py-3 text-slate-900 shadow-xl backdrop-blur-lg">
          <button
            onClick={isActive ? handleStopCall : handleStartCall}
            disabled={isCallButtonDisabled}
            className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
              isActive
                ? 'bg-rose-500 text-white hover:bg-rose-600'
                : 'bg-emerald-500 text-white hover:bg-emerald-600'
            } ${isCallButtonDisabled ? 'cursor-not-allowed opacity-70 hover:bg-emerald-500' : ''}`}
          >
            {isActive ? (
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                />
              </svg>
            )}
            <span>{callButtonLabel}</span>
          </button>

          <button
            onMouseDown={handleHoldStart}
            onMouseUp={handleHoldEnd}
            onMouseLeave={handleHoldCancel}
            onTouchStart={event => {
              event.preventDefault();
              handleHoldStart();
            }}
            onTouchEnd={event => {
              event.preventDefault();
              handleHoldEnd();
            }}
            onTouchCancel={event => {
              event.preventDefault();
              handleHoldCancel();
            }}
            disabled={isHoldDisabled}
            className={`flex min-w-[160px] items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 ${
              isHolding
                ? 'bg-blue-600 text-white shadow-lg'
                : isHoldDisabled
                ? 'bg-slate-200 text-slate-500'
                : 'bg-blue-500 text-white hover:bg-blue-600 shadow-lg/50'
            }`}
          >
            {isHolding ? 'Release to send' : 'Hold to talk'}
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes wave {
          0%, 100% { height: 20%; }
          50% { height: 80%; }
        }
        .animate-wave {
          animation: wave 1s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
