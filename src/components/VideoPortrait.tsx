'use client';

import { useEffect, useRef, useState } from 'react';

interface VideoPortraitProps {
  videoSrc: string;
  alt?: string;
  className?: string;
  size?: number;
  onError?: () => void;
}

export default function VideoPortrait({
  videoSrc,
  alt = 'Video portrait',
  className = '',
  size,
  onError,
}: VideoPortraitProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedData = () => {
      setIsLoaded(true);
    };

    const handleError = () => {
      setHasError(true);
      onError?.();
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('error', handleError);

    // Attempt to play the video
    video.play().catch(() => {
      // Autoplay might be blocked, but that's okay for a loop
      console.log('Autoplay was prevented, but video will play when ready');
    });

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
    };
  }, [videoSrc, onError]);

  if (hasError) {
    return null; // Parent will handle fallback
  }

  return (
    <div
      className={`relative overflow-hidden rounded-full ${className} ${!size ? 'w-full h-full' : ''}`}
      style={size ? { width: size, height: size } : undefined}
    >
      {/* Loading shimmer effect */}
      {!isLoaded && (
        <div
          className="absolute inset-0 animate-pulse bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200"
          style={{ borderRadius: '50%' }}
        />
      )}

      {/* Video element */}
      <video
        ref={videoRef}
        src={videoSrc}
        loop
        muted
        playsInline
        autoPlay
        className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        style={{
          objectPosition: 'center',
        }}
        aria-label={alt}
      />
    </div>
  );
}
