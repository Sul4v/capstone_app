'use client';

import { useState } from 'react';

export default function TestVideoPage() {
    const [imageUrl, setImageUrl] = useState(
        'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Elon_Musk_Royal_Society_%28crop2%29.jpg/400px-Elon_Musk_Royal_Society_%28crop2%29.jpg',
    );
    const [prompt, setPrompt] = useState(
        'Create a short, 5-8 second animated character headshot based on the provided reference image. This is for a class project and will not be commercially used. Use a stylized, non-photoreal look (e.g., animated/illustrated) so it is clearly not the real person. Keep the head facing forward, mouth closed, with subtle slow motions to bring the character to life. Do not reference personal names or identities; rely only on visual cues from the image. The video should be loopable and seamless.',
    );
    const [loading, setLoading] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        setVideoUrl(null);

        try {
            const response = await fetch('/api/test-video', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ imageUrl, prompt }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to generate video');
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            setVideoUrl(url);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8 font-sans">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold mb-8">Video Generation Tester</h1>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium mb-2 text-gray-300">
                                Image URL
                            </label>
                            <input
                                type="text"
                                value={imageUrl}
                                onChange={e => setImageUrl(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2 text-gray-300">
                                Prompt
                            </label>
                            <textarea
                                value={prompt}
                                onChange={e => setPrompt(e.target.value)}
                                rows={8}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                        </div>

                        <button
                            onClick={handleGenerate}
                            disabled={loading}
                            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors"
                        >
                            {loading ? 'Generating...' : 'Generate Video'}
                        </button>

                        {error && (
                            <div className="bg-red-900/50 border border-red-500 text-red-200 p-4 rounded-lg">
                                {error}
                            </div>
                        )}
                    </div>

                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium mb-2 text-gray-300">
                                Preview
                            </label>
                            <div className="aspect-square bg-gray-800 rounded-lg overflow-hidden border border-gray-700 flex items-center justify-center">
                                {videoUrl ? (
                                    <video
                                        src={videoUrl}
                                        controls
                                        autoPlay
                                        loop
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="text-gray-500 text-center p-4">
                                        {loading ? (
                                            <div className="animate-pulse">Generating video...</div>
                                        ) : (
                                            'Video preview will appear here'
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {imageUrl && (
                            <div>
                                <label className="block text-sm font-medium mb-2 text-gray-300">
                                    Source Image
                                </label>
                                <div className="aspect-square bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={imageUrl}
                                        alt="Source"
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
