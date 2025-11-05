'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimatedPortraitProps {
  imageUrl: string;
  alt: string;
  className?: string;
  intensity?: number; // 0-1, how strong the displacement effect is
}

/**
 * AnimatedPortrait component using Canvas 2D for subtle breathing/idle animation
 * Uses displacement mapping technique to create organic movement
 */
export default function AnimatedPortrait({
  imageUrl,
  alt,
  className = '',
  intensity = 0.5,
}: AnimatedPortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;

    // Load the image
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      imageRef.current = img;
      canvas.width = img.width;
      canvas.height = img.height;
      setIsLoading(false);
      startAnimation();
    };

    img.onerror = () => {
      console.error('Failed to load portrait image:', imageUrl);
      setHasError(true);
      setIsLoading(false);
    };

    img.src = imageUrl;

    let startTime = Date.now();

    const startAnimation = () => {
      const animate = () => {
        if (!canvas || !ctx || !imageRef.current) return;

        const elapsed = (Date.now() - startTime) / 1000; // seconds

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Save context state
        ctx.save();

        // Create breathing effect using scale + translate
        // Breathing cycle: 4 seconds (slow, natural breathing)
        const breathingCycle = Math.sin(elapsed * Math.PI * 0.5) * 0.015 * intensity; // ±1.5% scale
        const scale = 1 + breathingCycle;

        // Subtle head tilt/sway
        const swayX = Math.sin(elapsed * 0.3) * 2 * intensity; // ±2px horizontal
        const swayY = Math.cos(elapsed * 0.25) * 1.5 * intensity; // ±1.5px vertical
        const rotation = Math.sin(elapsed * 0.2) * 0.004 * intensity; // ±0.4 degrees

        // Apply transformations from center
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        ctx.translate(centerX + swayX, centerY + swayY);
        ctx.rotate(rotation);
        ctx.scale(scale, scale);
        ctx.translate(-centerX, -centerY);

        // Draw the image
        ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

        // Restore context
        ctx.restore();

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animate();
    };

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [imageUrl, intensity]);

  if (hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-800 ${className}`}
      >
        <svg
          className="h-1/2 w-1/2 text-slate-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-800">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white/80" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`h-full w-full object-cover ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
        aria-label={alt}
      />
    </div>
  );
}
