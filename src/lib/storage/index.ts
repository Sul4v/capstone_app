import fs from 'node:fs/promises';
import path from 'node:path';
import { put, list } from '@vercel/blob';

export interface StorageService {
    upload(pathName: string, buffer: Buffer): Promise<string>;
    exists(pathName: string): Promise<boolean>;
    download(pathName: string): Promise<Buffer | null>;
    getUrl(pathName: string): string;
}

class LocalStorageService implements StorageService {
    private publicDir = path.join(process.cwd(), 'public');

    constructor() {
        // Ensure base directory exists
        fs.mkdir(this.publicDir, { recursive: true }).catch((err) => {
            console.warn('[Storage] Failed to create public directory:', err);
        });
    }

    async upload(pathName: string, buffer: Buffer): Promise<string> {
        const filePath = path.join(this.publicDir, pathName);
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, buffer);
        } catch (error) {
            console.error('[Storage] Failed to save file locally:', error);
            throw new Error('Failed to save file. Storage might be read-only.');
        }
        return this.getUrl(pathName);
    }

    async exists(pathName: string): Promise<boolean> {
        try {
            const filePath = path.join(this.publicDir, pathName);
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async download(pathName: string): Promise<Buffer | null> {
        try {
            const filePath = path.join(this.publicDir, pathName);
            return await fs.readFile(filePath);
        } catch {
            return null;
        }
    }

    getUrl(pathName: string): string {
        return `/${pathName}`;
    }
}

class VercelBlobStorageService implements StorageService {
    async upload(pathName: string, buffer: Buffer): Promise<string> {
        const { url } = await put(pathName, buffer, {
            access: 'public',
            addRandomSuffix: false, // Keep filename consistent for caching
        });
        return url;
    }

    async exists(pathName: string): Promise<boolean> {
        try {
            const { blobs } = await list({
                prefix: pathName,
                limit: 1
            });
            return blobs.length > 0;
        } catch (error) {
            console.warn('[Storage] Failed to check blob existence:', error);
            return false;
        }
    }

    async download(pathName: string): Promise<Buffer | null> {
        try {
            const { blobs } = await list({
                prefix: pathName,
                limit: 1
            });
            if (blobs.length === 0) return null;

            const response = await fetch(blobs[0].url);
            if (!response.ok) return null;

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (error) {
            console.warn('[Storage] Failed to download blob:', error);
            return null;
        }
    }

    getUrl(pathName: string): string {
        // This is still tricky without the base URL.
        // We rely on the client knowing the base URL or the upload returning it.
        // For now, return empty string as it's mostly used for upload return.
        return '';
    }
}

// Factory to get the appropriate storage service
function getStorageService(): StorageService {
    const provider = process.env.STORAGE_PROVIDER;
    const hasBlobToken = !!process.env.BLOB_READ_WRITE_TOKEN;
    const isVercel = !!process.env.VERCEL;

    console.log(`[Storage] Initializing. Provider: '${provider}', HasBlobToken: ${hasBlobToken}, IsVercel: ${isVercel}`);

    if (provider === 'vercel-blob') {
        if (!hasBlobToken) {
            console.error('[Storage] CRITICAL: STORAGE_PROVIDER is vercel-blob but BLOB_READ_WRITE_TOKEN is missing. Falling back to local storage (will fail in production).');
            return new LocalStorageService();
        }
        return new VercelBlobStorageService();
    }

    if (isVercel) {
        console.warn('[Storage] WARNING: Running on Vercel but STORAGE_PROVIDER is not set to vercel-blob. This will likely cause errors as local filesystem is read-only.');
    }

    return new LocalStorageService();
}

export const storage = getStorageService();
