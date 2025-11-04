import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Add empty turbopack config to silence warning
  turbopack: {},

  webpack: (config) => {
    // Handle audio files
    config.module.rules.push({
      test: /\.(mp3|wav|ogg|m4a)$/,
      type: 'asset/resource',
    });
    return config;
  },

  // Configure external API domains for images/media
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.deepgram.com',
      },
      {
        protocol: 'https',
        hostname: 'api.elevenlabs.io',
      },
      {
        protocol: 'https',
        hostname: 'api.openai.com',
      },
    ],
  },

  // Enable experimental features if needed
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
