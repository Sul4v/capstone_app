import fs from 'node:fs/promises';
import path from 'node:path';
import { put, list } from '@vercel/blob';

export interface StorageService {
    upload(filename: string, buffer: Buffer): Promise<string>;
    exists(filename: string): Promise<boolean>;
    getUrl(filename: string): string;
}

class LocalStorageService implements StorageService {
    private publicDir = path.join(process.cwd(), 'public');
    private baseDir = path.join(this.publicDir, 'personas', 'videos');

    constructor() {
        // Ensure directory exists
        fs.mkdir(this.baseDir, { recursive: true }).catch(console.error);
    }

    async upload(filename: string, buffer: Buffer): Promise<string> {
        const filePath = path.join(this.baseDir, filename);
        await fs.writeFile(filePath, buffer);
        return this.getUrl(filename);
    }

    async exists(filename: string): Promise<boolean> {
        try {
            const filePath = path.join(this.baseDir, filename);
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    getUrl(filename: string): string {
        return `/personas/videos/${filename}`;
    }
}

class VercelBlobStorageService implements StorageService {
    async upload(filename: string, buffer: Buffer): Promise<string> {
        const { url } = await put(`personas/videos/${filename}`, buffer, {
            access: 'public',
            addRandomSuffix: false, // Keep filename consistent for caching
        });
        return url;
    }

    async exists(filename: string): Promise<boolean> {
        try {
            const { blobs } = await list({
                prefix: `personas/videos/${filename}`,
                limit: 1
            });
            return blobs.length > 0;
        } catch (error) {
            console.warn('[Storage] Failed to check blob existence:', error);
            return false;
        }
    }

    getUrl(filename: string): string {
        // This is still tricky without the base URL.
        // We rely on the client knowing the base URL or the upload returning it.
        // For now, return empty string as it's mostly used for upload return.
        return '';
    }
}

// Factory to get the appropriate storage service
function getStorageService(): StorageService {
    const provider = process.env.STORAGE_PROVIDER || 'local';

    if (provider === 'vercel-blob') {
        if (!process.env.BLOB_READ_WRITE_TOKEN) {
            console.warn('[Storage] BLOB_READ_WRITE_TOKEN not set. Falling back to local storage.');
            return new LocalStorageService();
        }
        return new VercelBlobStorageService();
    }

    return new LocalStorageService();
}

export const storage = getStorageService();
