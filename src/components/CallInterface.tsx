'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Image from 'next/image';
import {
  startRecording,
  stopRecording,
  isAudioRecordingSupported,
  playAudio,
} from '@/lib/audio-utils';
import { Message, MediaItem, Portrait } from '@/types';
import { useCallStore } from '@/lib/store';
import UserNameModal from '@/components/UserNameModal';
import ExpertBadge from '@/components/ExpertBadge';
import MessageBubble from '@/components/MessageBubble';
import { StreamingAudioPlayer } from '@/lib/streaming-audio-player';
import AnimatedPortrait from '@/components/AnimatedPortrait';
import VideoPortrait from '@/components/VideoPortrait';
import { CONCIERGE_VIDEO_PATH, getPersonaVideoPath, checkVideoExists } from '@/lib/video-utils';

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
const ENABLE_MEDIA_PREVIEW = false;

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
    setSelectedMessageId,
    resetMedia,
  } = useCallStore();

  const [isBrowserSupported, setIsBrowserSupported] = useState(true);
  const [isStartLoading, setIsStartLoading] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [mediaPointerStartX, setMediaPointerStartX] = useState<number | null>(
    null,
  );
  const [expertPortrait, setExpertPortrait] = useState<Portrait | null>(null);
  const [isPortraitLoading, setIsPortraitLoading] = useState(false);
  const [personaVideoPath, setPersonaVideoPath] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const lastFetchedExpertRef = useRef<string | null>(null);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(new Set());
  const [textInput, setTextInput] = useState('');
  const [showExpertDetails, setShowExpertDetails] = useState(false);

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

  // Fetch expert portrait when expert changes
  useEffect(() => {
    const fetchPortrait = async () => {
      if (!currentExpert?.name) {
        setExpertPortrait(null);
        lastFetchedExpertRef.current = null;
        return;
      }

      // Skip if we already fetched this expert
      if (lastFetchedExpertRef.current === currentExpert.name) {
        return;
      }

      lastFetchedExpertRef.current = currentExpert.name;
      setIsPortraitLoading(true);

      try {
        const response = await fetch(
          `/api/expert/portrait?name=${encodeURIComponent(currentExpert.name)}`,
        );

        if (!response.ok) {
          throw new Error('Failed to fetch portrait');
        }

        const data = await response.json();
        if (data.success && data.portrait) {
          setExpertPortrait(data.portrait);
        }
      } catch (error) {
        console.error('Error fetching expert portrait:', error);
        setExpertPortrait(null);
      } finally {
        setIsPortraitLoading(false);
      }
    };

    fetchPortrait();
  }, [currentExpert?.name]);

  // Check for video availability when expert changes or for concierge
  useEffect(() => {
    const checkVideo = async () => {
      let videoPath: string | null = null;

      // If no expert, use concierge video
      if (!currentExpert?.name) {
        videoPath = CONCIERGE_VIDEO_PATH;
      } else {
        // Check if expert has a video
        videoPath = getPersonaVideoPath(currentExpert.name);
      }

      // Check if the video exists
      const exists = await checkVideoExists(videoPath);

      if (exists) {
        setPersonaVideoPath(videoPath);
        setHasVideo(true);
      } else {
        setPersonaVideoPath(null);
        setHasVideo(false);
      }
    };

    checkVideo();
  }, [currentExpert?.name]);

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
      // No circular navigation - stop at last item
      return Math.min(prev + 1, total - 1);
    });
  }, [mediaItemCount]);

  const goToPreviousMediaCard = useCallback(() => {
    setActiveMediaIndex(prev => {
      const total =
        mediaItemCount > 0 ? mediaItemCount : MEDIA_CARD_PLACEHOLDERS.length;
      if (total <= 0) return 0;
      // No circular navigation - stop at first item
      return Math.max(prev - 1, 0);
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
    (reason: 'preview' | 'final', messageId: string) => {
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
        // Lower threshold for final fetch to ensure we get images even for short responses
        if (delta < 20 && mediaRequestInFlightRef.current !== 'preview') {
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
        limit: 3, // Changed from 5 to 3
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

          // Store media items in the message
          updateMessage(messageId, (message) => ({
            ...message,
            mediaItems: items,
          }));

          // Display media for this message
          setMediaItems(items);
          setSelectedMessageId(messageId);

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
    [
      abortPendingMediaRequest,
      setIsMediaLoading,
      setMediaError,
      setMediaItems,
      setSelectedMessageId,
      updateMessage,
    ],
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
      setIsStartLoading(false); // Allow user to interact immediately

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
      // Stop any currently playing audio (including greeting)
      stopPlayback();
      setIsHolding(true);
      isHoldingRef.current = true;
      setStatus('listening');

      const recorder = await startRecording();
      mediaRecorderRef.current = recorder;
      recorder.start();

      // Clear any greeting message if we're interrupting it
      if (callStatus === 'speaking') {
        addSystemMessage('Greeting interrupted. Recording your question...');
      } else {
        addSystemMessage('Recording... release to send your question.');
      }
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

  const handleSendTextMessage = useCallback(async () => {
    if (!textInput.trim() || !isActive || isProcessing || isSpeaking) {
      return;
    }

    const textMessage = textInput.trim();
    setTextInput(''); // Clear input immediately

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

      if (!sessionIdRef.current) {
        setStatus('idle');
        return;
      }

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
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionIdRef.current,
        },
        body: JSON.stringify({ message: textMessage }),
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

              // Update media context and trigger preview fetch
              if (ENABLE_MEDIA_PREVIEW && expertMessageId) {
                mediaContextRef.current.responsePreview = fullExpertResponse;
                triggerMediaFetch('preview', expertMessageId);
              }
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

              // Final media fetch with complete response
              mediaContextRef.current.responsePreview = fullExpertResponse;
              if (expertMessageId) {
                triggerMediaFetch('final', expertMessageId);
              }
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

      handleError(err, 'send-text-message');

      if (processingMessageId) {
        removeMessage(processingMessageId);
      }

      if (!isHoldingRef.current) {
        setStatus('idle');
      } else {
        setStatus('listening');
      }
    }
  }, [
    textInput,
    isActive,
    isProcessing,
    isSpeaking,
    currentExpert,
    abortPendingMediaRequest,
    resetMedia,
    setStatus,
    addMessage,
    stopPlayback,
    removeMessage,
    setCurrentExpert,
    updateMessage,
    triggerMediaFetch,
    getStreamingPlayer,
    addSystemMessage,
    handleError,
    setTextInput,
  ]);

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

              // Update media context and trigger preview fetch
              if (ENABLE_MEDIA_PREVIEW && expertMessageId) {
                mediaContextRef.current.responsePreview = fullExpertResponse;
                triggerMediaFetch('preview', expertMessageId);
              }
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

              // Final media fetch with complete response
              mediaContextRef.current.responsePreview = fullExpertResponse;
              if (expertMessageId) {
                triggerMediaFetch('final', expertMessageId);
              }
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
    abortPendingMediaRequest,
    resetMedia,
    triggerMediaFetch,
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
          : "Responding with your concierge's answer. (Hold button to interrupt)";

  const isCallButtonDisabled = !isActive && isStartLoading;
  const callButtonLabel = isActive
    ? 'End Call'
    : isStartLoading
      ? 'Starting...'
      : 'Start Call';

  const totalMediaItems = mediaItems.length > 0 ? mediaItems.length : MEDIA_CARD_PLACEHOLDERS.length;
  const canGoToPrevious = activeMediaIndex > 0;
  const canGoToNext = activeMediaIndex < totalMediaItems - 1;

  return (
    <div className="relative min-h-screen bg-slate-950 text-gray-100 lg:flex lg:h-screen lg:flex-col lg:overflow-hidden font-sans selection:bg-indigo-500/30">
      {error ? (
        <div className="fixed top-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-red-500/20 bg-red-500/10 px-6 py-4 text-red-200 shadow-2xl backdrop-blur-xl transition-all animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-4">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <span className="text-sm font-medium tracking-wide">{error}</span>
            <button
              onClick={() => {
                if (errorTimeoutRef.current) {
                  clearTimeout(errorTimeoutRef.current);
                }
                setError(null);
              }}
              className="ml-2 rounded-full p-1 text-red-200/70 transition-colors hover:bg-red-500/20 hover:text-red-100"
              aria-label="Dismiss error"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-col lg:h-full lg:min-h-0 lg:flex-row">
        {/* Main Content Area */}
        <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden lg:flex lg:w-[70%] xl:w-[75%] bg-slate-100">
          {/* Dynamic Background */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-100/60 via-slate-50 to-white" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_var(--tw-gradient-stops))] from-violet-100/40 via-slate-50 to-white" />

          {/* Animated Blobs */}
          <div className="absolute -top-[20%] -left-[10%] h-[50vw] w-[50vw] rounded-full bg-indigo-200/20 blur-[120px] animate-pulse duration-[8000ms]" />
          <div className="absolute top-[20%] right-[-10%] h-[40vw] w-[40vw] rounded-full bg-violet-200/15 blur-[100px] animate-pulse duration-[10000ms] delay-1000" />
          <div className="absolute bottom-[-10%] left-[20%] h-[30vw] w-[30vw] rounded-full bg-blue-200/15 blur-[80px] animate-pulse duration-[12000ms] delay-2000" />

          {/* Expert Portrait (Top Right) */}
          <div
            className="group absolute top-8 right-8 z-50 h-40 w-40 overflow-hidden rounded-full border border-white/10 bg-slate-900 shadow-2xl transition-transform hover:scale-105"
            title={expertPortrait?.attribution || undefined}
          >
            {hasVideo && personaVideoPath ? (
              <VideoPortrait
                videoSrc={personaVideoPath}
                alt={currentExpert?.name || 'Concierge'}
                className="h-full w-full"
                onError={() => {
                  setHasVideo(false);
                  setPersonaVideoPath(null);
                }}
              />
            ) : expertPortrait?.url && !isPortraitLoading ? (
              <>
                <AnimatedPortrait
                  imageUrl={expertPortrait.url}
                  alt={currentExpert?.name || 'Expert portrait'}
                  className="h-full w-full"
                  intensity={0.6}
                />
                {expertPortrait.attribution && (
                  <div className="absolute inset-x-0 bottom-0 translate-y-full bg-black/80 px-2 py-1 text-[10px] text-white/90 backdrop-blur-md transition-transform group-hover:translate-y-0 text-center">
                    {expertPortrait.attribution}
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/5 text-white/40">
                {isPortraitLoading ? (
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                ) : (
                  <svg className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                )}
              </div>
            )}
          </div>

          {/* Main Content Container */}
          <div className="relative z-10 flex h-full flex-col p-12 text-white">

            {/* Carousel Section */}
            <div className="relative flex flex-1 items-center justify-center perspective-1000">
              {/* Navigation Buttons */}
              {canGoToPrevious && (
                <button
                  onClick={goToPreviousMediaCard}
                  className="absolute left-4 top-1/2 z-40 -translate-y-1/2 rounded-full border border-white/10 bg-white/5 p-4 text-white/70 backdrop-blur-md transition-all hover:bg-white/10 hover:text-white hover:scale-110 active:scale-95 group"
                  aria-label="Previous image"
                >
                  <svg className="h-6 w-6 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}

              {/* Cards Container */}
              <div
                className="relative flex h-[60vh] w-full max-w-7xl items-center justify-center select-none cursor-grab active:cursor-grabbing touch-pan-y"
                onPointerDown={handleMediaPointerDown}
                onPointerUp={handleMediaPointerUp}
                onPointerCancel={handleMediaPointerCancel}
                role="presentation"
              >
                {(mediaItems.length > 0 ? mediaItems : MEDIA_CARD_PLACEHOLDERS).map((item, index) => {
                  const isActive = index === activeMediaIndex;
                  const isMediaItem = 'imageUrl' in item;

                  // Calculate offset from active index
                  const offset = index - activeMediaIndex;
                  const absOffset = Math.abs(offset);

                  // Visibility logic
                  if (absOffset > 2) return null;

                  let transform = '';
                  let zIndex = 0;
                  let opacity = 0;
                  let pointerEvents = 'pointer-events-none';

                  if (isActive) {
                    transform = 'translateX(0) scale(1) translateZ(0)';
                    zIndex = 30;
                    opacity = 1;
                    pointerEvents = 'pointer-events-auto';
                  } else {
                    const sign = offset > 0 ? 1 : -1;
                    const translateX = sign * (50 + (absOffset * 5)); // Percentage
                    const scale = 0.85 - (absOffset * 0.1);
                    const rotateY = sign * -15; // Slight 3D rotation

                    transform = `translateX(${translateX}%) scale(${scale}) perspective(1000px) rotateY(${rotateY}deg)`;
                    zIndex = 20 - absOffset;
                    opacity = 0.5 - (absOffset * 0.15);
                  }

                  return (
                    <div
                      key={isMediaItem ? item.id : (item as typeof MEDIA_CARD_PLACEHOLDERS[number]).id}
                      className={`absolute aspect-video h-full max-h-[700px] w-auto transition-all duration-700 cubic-bezier(0.25, 1, 0.5, 1) ${pointerEvents}`}
                      style={{
                        transform,
                        zIndex,
                        opacity,
                      }}
                      aria-hidden={!isActive}
                    >
                      <div className={`h-full w-full overflow-hidden rounded-[2.5rem] border border-white/10 bg-slate-900/80 shadow-2xl backdrop-blur-xl ${isActive ? 'shadow-indigo-500/20 ring-1 ring-white/20' : ''}`}>
                        {isMediaItem ? (
                          <div className="relative h-full w-full group">
                            {failedImageIds.has(item.id) ? (
                              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-rose-950/30 to-slate-950/30 p-8 text-center">
                                <div className="rounded-full bg-rose-500/10 p-6 backdrop-blur-sm mb-4">
                                  <svg className="h-12 w-12 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                  </svg>
                                </div>
                                <p className="text-lg font-medium text-rose-200/80 mb-2">Image Failed to Load</p>
                                <p className="text-sm text-slate-400 max-w-md mb-4">This image couldn't be displayed. It may be blocked by an ad blocker, browser extension, or CORS policy.</p>
                                <p className="text-xs text-slate-500">{item.caption}</p>
                                {item.sourceUrl && (
                                  <a
                                    href={item.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white/70 transition-all hover:bg-white/20 hover:text-white"
                                  >
                                    <span>View Source</span>
                                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                  </a>
                                )}
                              </div>
                            ) : (
                              <>
                                <Image
                                  src={item.imageUrl}
                                  alt={item.caption}
                                  fill
                                  className="object-contain transition-transform duration-700 group-hover:scale-105"
                                  sizes="(max-width: 768px) 100vw, 80vw"
                                  priority={isActive}
                                  unoptimized
                                  onError={() => {
                                    console.error(`Failed to load image: ${item.id}`, item.imageUrl);
                                    setFailedImageIds(prev => new Set(prev).add(item.id));
                                  }}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80" />
                                <div className="absolute inset-x-0 bottom-0 p-8 transform transition-transform duration-500 translate-y-2 group-hover:translate-y-0">
                                  <p className="text-lg font-medium leading-relaxed text-white drop-shadow-lg">
                                    {item.caption}
                                  </p>
                                  {item.attribution && (
                                    <p className="mt-3 text-xs font-medium tracking-wider text-white/50 uppercase">
                                      Source: {item.attribution}
                                    </p>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-white/5 to-transparent p-8 text-center">
                            {isMediaLoading && isActive ? (
                              <div className="flex flex-col items-center gap-6">
                                <div className="relative h-16 w-16">
                                  <div className="absolute inset-0 animate-ping rounded-full bg-indigo-500/20" />
                                  <div className="relative flex h-full w-full items-center justify-center rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
                                </div>
                                <span className="text-sm font-medium tracking-[0.2em] text-indigo-200/70 uppercase animate-pulse">
                                  Generating Visuals...
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-4 text-white/20">
                                <div className="rounded-full bg-white/5 p-6 backdrop-blur-sm">
                                  <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                                <span className="text-sm font-medium tracking-[0.2em] uppercase">
                                  {(item as typeof MEDIA_CARD_PLACEHOLDERS[number]).label}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {canGoToNext && (
                <button
                  onClick={goToNextMediaCard}
                  className="absolute right-4 top-1/2 z-40 -translate-y-1/2 rounded-full border border-white/10 bg-white/5 p-4 text-white/70 backdrop-blur-md transition-all hover:bg-white/10 hover:text-white hover:scale-110 active:scale-95 group"
                  aria-label="Next image"
                >
                  <svg className="h-6 w-6 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}

              {/* Pagination Dots */}
              {totalMediaItems > 1 && (
                <div className="absolute -bottom-8 left-1/2 z-40 flex -translate-x-1/2 gap-3">
                  {Array.from({ length: totalMediaItems }).map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setActiveMediaIndex(index)}
                      className={`h-1.5 rounded-full transition-all duration-500 ${index === activeMediaIndex
                        ? 'w-8 bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]'
                        : 'w-1.5 bg-white/20 hover:bg-white/40'
                        }`}
                      aria-label={`Go to image ${index + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Visualizer Section */}
            <div className="mt-12 rounded-3xl border border-slate-200 bg-white p-8 shadow-lg">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className={`relative flex h-3 w-3`}>
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${statusIndicatorColor}`} />
                    <span className={`relative inline-flex h-3 w-3 rounded-full ${statusIndicatorColor}`} />
                  </div>
                  <span className="text-xs font-bold tracking-[0.2em] text-slate-700 uppercase">
                    {callStatus === 'listening' ? 'Listening' : callStatus === 'speaking' ? 'Speaking' : callStatus === 'processing' ? 'Processing' : 'Standby'}
                  </span>
                </div>
                <div className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
                  Live Audio Stream
                </div>
              </div>

              <div className="flex h-24 items-end justify-between gap-1.5 px-2">
                {[...Array(32)].map((_, i) => {
                  const baseHeight = 10 + Math.sin(i * 0.5) * 5;
                  const listeningHeight = 20 + Math.random() * 60;
                  const speakingHeight = 30 + Math.sin(Date.now() / 100 + i) * 40; // Simulated

                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-full transition-all duration-150 ease-in-out ${callStatus === 'listening'
                        ? 'bg-gradient-to-t from-rose-500 to-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.5)]'
                        : callStatus === 'speaking'
                          ? 'bg-gradient-to-t from-emerald-500 to-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                          : callStatus === 'processing'
                            ? 'bg-gradient-to-t from-amber-500 to-amber-300 animate-pulse'
                            : 'bg-slate-200'
                        }`}
                      style={{
                        height: callStatus === 'listening'
                          ? `${listeningHeight}%`
                          : callStatus === 'speaking'
                            ? `${30 + Math.random() * 50}%` // Simple random for now, ideally driven by audio data
                            : `${baseHeight}%`,
                      }}
                    />
                  );
                })}
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4">
                <p className="text-sm font-medium text-indigo-600">
                  {statusHelperText}
                </p>
                {callStatus === 'processing' && (
                  <div className="h-1 w-24 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full w-1/2 animate-[shimmer_1s_infinite] bg-gradient-to-r from-transparent via-indigo-400 to-transparent" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Sidebar / Chat Area */}
        <section className="flex min-h-screen w-full flex-col border-l border-slate-200 bg-white lg:h-full lg:w-[30%] lg:min-h-0 lg:overflow-hidden xl:w-[25%]">
          <div className="flex flex-col gap-6 px-8 pb-6 pt-10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  {currentExpert?.name || 'Concierge'}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {currentExpert
                    ? `Expert in ${currentExpert.expertiseAreas?.join(', ') || 'various topics'}`
                    : 'Your personal AI expert interface. Start a call to begin the conversation.'}
                </p>
              </div>
              {currentExpert && (
                <button
                  onClick={() => setShowExpertDetails(!showExpertDetails)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Toggle expert details"
                >
                  <svg
                    className={`h-4 w-4 transition-transform duration-200 ${showExpertDetails ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
            </div>

            <div className="h-px w-full bg-gradient-to-r from-slate-200 to-transparent" />

            {currentExpert && showExpertDetails && (
              <div className="animate-in slide-in-from-top-2 fade-in duration-200">
                <ExpertBadge expert={currentExpert} />
              </div>
            )}
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
            <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 lg:min-h-0">
              <div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 py-6">
                <div className="space-y-3">
                  {conversationHistory.length === 0 ? (
                    <p className="py-12 text-center text-sm text-gray-500">
                      No messages yet. Start a call to begin the conversation.
                    </p>
                  ) : (
                    conversationHistory.map(message => (
                      <div
                        key={message.id}
                        onClick={() => {
                          // Show media for this message if it has any
                          if (message.mediaItems && message.mediaItems.length > 0) {
                            setMediaItems(message.mediaItems);
                            setSelectedMessageId(message.id);
                          }
                        }}
                        className={
                          message.mediaItems && message.mediaItems.length > 0
                            ? 'cursor-pointer'
                            : ''
                        }
                      >
                        <MessageBubble message={message} />
                      </div>
                    ))
                  )}
                </div>
                <div ref={messagesEndRef} />
              </div>

              {/* Text Input Box */}
              {isActive && (
                <div className="border-t border-slate-200 p-4">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendTextMessage();
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      placeholder="Type a message..."
                      disabled={!isActive || isProcessing || isSpeaking}
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition-all focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <button
                      type="submit"
                      disabled={!textInput.trim() || !isActive || isProcessing || isSpeaking}
                      className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-500"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 w-full max-w-2xl -translate-x-1/2 px-4 lg:left-[35%] xl:left-[35%]">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-3 rounded-full border border-slate-200 bg-white/90 px-4 py-3 text-slate-900 shadow-2xl backdrop-blur-lg">

          <button
            onClick={isActive ? handleStopCall : handleStartCall}
            disabled={isCallButtonDisabled}
            className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${isActive
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
            className={`flex min-w-[160px] items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 ${isHolding
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
