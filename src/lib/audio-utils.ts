/**
 * Audio utility functions for handling recording and playback
 */

/**
 * Start recording audio from the user's microphone
 * @returns Promise that resolves to a MediaRecorder instance
 */
export async function startRecording(): Promise<MediaRecorder> {
  try {
    // Request microphone permission
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
      }
    });

    // Determine the best supported MIME type
    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/wav')) {
      mimeType = 'audio/wav';
    }

    // Create MediaRecorder with optimized settings
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 128000,
    });

    console.log('MediaRecorder created with mimeType:', mimeType);

    return mediaRecorder;
  } catch (error) {
    console.error('Error starting recording:', error);
    throw new Error('Failed to access microphone. Please grant permission and try again.');
  }
}

/**
 * Stop recording and return the audio as a Blob
 * @param recorder - The MediaRecorder instance to stop
 * @returns Promise that resolves to an audio Blob
 */
export function stopRecording(recorder: MediaRecorder): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const audioChunks: BlobPart[] = [];

    // Collect audio data as it becomes available
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    // When recording stops, combine chunks into a single Blob
    recorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: recorder.mimeType });
      console.log('Recording stopped. Blob size:', audioBlob.size, 'bytes');

      // Stop all tracks to release the microphone
      recorder.stream.getTracks().forEach(track => track.stop());

      resolve(audioBlob);
    };

    // Handle errors
    recorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
      reject(new Error('Recording failed'));
    };

    // Stop the recorder
    if (recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      reject(new Error('Recorder is already stopped'));
    }
  });
}

type PlayAudioOptions = {
  signal?: AbortSignal;
};

/**
 * Play audio from a URL or Blob
 * @param audioUrl - URL string or Blob to play
 * @param options - Optional playback controls (abort signal)
 * @returns Promise that resolves when audio finishes playing or is aborted
 */
export function playAudio(
  audioUrl: string | Blob,
  options: PlayAudioOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const { signal } = options;

    const url =
      typeof audioUrl === 'string'
        ? audioUrl
        : URL.createObjectURL(audioUrl);

    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (typeof audioUrl !== 'string') {
        URL.revokeObjectURL(url);
      }
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
    };

    const handleAbort = () => {
      cleanup();
      resolve();
    };

    if (signal) {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    audio.onended = () => {
      cleanup();
      resolve();
    };

    audio.onerror = (error) => {
      console.error('Audio playback error:', error);
      cleanup();
      reject(new Error('Failed to play audio'));
    };

    audio.onpause = () => {
      if (signal?.aborted) {
        cleanup();
        resolve();
      }
    };

    audio.src = url;
    audio.play().catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

/**
 * Check if the browser supports audio recording
 * @returns boolean indicating support
 */
export function isAudioRecordingSupported(): boolean {
  return !!(
    navigator.mediaDevices &&
    (navigator.mediaDevices as any).getUserMedia &&
    window.MediaRecorder
  );
}
