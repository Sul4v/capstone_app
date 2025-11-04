'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import {
  startRecording,
  stopRecording,
  isAudioRecordingSupported,
  playAudio,
} from '@/lib/audio-utils';
import { Message } from '@/types';
import { useCallStore } from '@/lib/store';
import ExpertBadge from '@/components/ExpertBadge';
import MessageBubble from '@/components/MessageBubble';

type CallStatus = 'idle' | 'listening' | 'processing' | 'speaking';

type StartCallResponse = {
  success?: boolean;
  sessionId?: string;
  greetingText?: string;
  audioBase64?: string;
  error?: string;
};

type CallMessageResponse = {
  success?: boolean;
  transcript?: string;
  expert?: {
    name: string;
    expertiseAreas?: string[];
    reasoning?: string;
  };
  responseText?: string;
  audioBase64?: string;
  error?: string;
  details?: string;
};

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
  } = useCallStore();

  const [isBrowserSupported, setIsBrowserSupported] = useState(true);
  const [isStartLoading, setIsStartLoading] = useState(false);
  const [isHolding, setIsHolding] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const playbackAbortRef = useRef<AbortController | null>(null);
  const isHoldingRef = useRef(false);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const stopPlayback = useCallback(() => {
    if (playbackAbortRef.current) {
      playbackAbortRef.current.abort();
      playbackAbortRef.current = null;
    }
  }, []);

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
    try {
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

      const response = await fetch('/api/call/message', {
        method: 'POST',
        body: formData,
      });

      let data: CallMessageResponse = {};
      try {
        data = (await response.json()) as CallMessageResponse;
      } catch {
        // ignore parse errors, handled below.
      }

      if (
        !response.ok ||
        !data?.success ||
        typeof data.transcript !== 'string' ||
        typeof data.responseText !== 'string' ||
        typeof data.audioBase64 !== 'string'
      ) {
        const errMessage =
          data?.error ??
          data?.details ??
          `Failed to process question (status ${response.status}).`;
        throw new Error(errMessage);
      }

      const cleanedTranscript = (data.transcript ?? '').trim();
      if (!cleanedTranscript) {
        handleError(new Error('No speech detected'), 'transcribe');
        if (processingMessageId) {
          updateMessage(processingMessageId, message => ({
            ...message,
            content:
              "I didn't catch anything there. Try holding the button and speaking again.",
            timestamp: new Date(),
          }));
        } else {
          addSystemMessage(
            "I didn't catch anything there. Try holding the button and speaking again.",
          );
        }
        setStatus('idle');
        return;
      }

      if (data.expert) {
        setCurrentExpert(data.expert);
      }

      if (processingMessageId) {
        removeMessage(processingMessageId);
      }

      addMessage({
        id: createMessageId(),
        role: 'user',
        content: cleanedTranscript,
        timestamp: new Date(),
      });

      addMessage({
        id: createMessageId(),
        role: 'expert',
        content: data.responseText ?? '',
        timestamp: new Date(),
        expertName: data.expert?.name ?? currentExpert?.name,
      });

      const responseAudio = base64ToBlob(data.audioBase64, 'audio/mpeg');
      stopPlayback();
      setStatus('speaking');
      const responseAbortController = new AbortController();
      playbackAbortRef.current = responseAbortController;
      try {
        await playAudio(responseAudio, {
          signal: responseAbortController.signal,
        });
      } finally {
        if (playbackAbortRef.current === responseAbortController) {
          playbackAbortRef.current = null;
        }
      }
      const nextStatus = isHoldingRef.current ? 'listening' : 'idle';
      setStatus(nextStatus);
    } catch (err) {
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
      setStatus('idle');
    }
  }, [
    addMessage,
    addSystemMessage,
    currentExpert,
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
          <div className="relative z-10 flex h-full flex-col justify-between p-16 text-white">
            <div className="max-w-xl space-y-6">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold uppercase tracking-widest text-white/80">
                Concierge Mode
              </span>
              <h1 className="text-4xl font-semibold leading-tight">
                Real-time support with your expert concierge.
              </h1>
              <p className="text-base text-white/80">
                This space is reserved for immersive call visuals, real-time analytics, and contextual information about your ongoing conversation.
              </p>
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
