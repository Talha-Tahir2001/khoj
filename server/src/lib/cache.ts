import type { Db } from "mongodb";
import {
    atlasAvailable,
    noteAtlasFailure,
    noteAtlasSuccess,
    withTimeout,
} from "./mongo.js";

/**
 * TTL cache backed by Atlas, with an in-memory layer in front of it.
 *
 * This is a suspension-risk mitigation, not a performance feature. Render may
 * suspend a free instance that "initiates an uncomably high volume of traffic
 * over the public internet — invoking external APIs", and four upstream calls
 * per request is exactly that pattern.
 */

interface CacheEntry<T> {
    value: T;
    expires_at: number;
}

const memory = new Map<string, CacheEntry<unknown>>();

/** Ceiling on any single Atlas operation. Beyond this, degrade to memory. */
const ATLAS_TIMEOUT_MS = 4000;

/** Anything with a Mongo TTL index can back the durable half. */
export interface CacheStore {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/**
 * Mongo collection-backed store. `collection` must have a TTL index on `expires_at`.
 *
 * Every operation is bounded by a timeout. Atlas is a cache, not a dependency —
 * if it is slow the request must still be served from memory, so a stalled read
 * degrades to a miss and a stalled write is dropped.
 */
export function mongoCacheStore(db: Db, collection = "cache"): CacheStore {
    const col = () => db.collection<CacheEntry<unknown> & { _id: string }>(collection);

    return {
        async get(key) {
            if (!atlasAvailable()) return null;
            try {
                const doc = await withTimeout(
                    col().findOne({ _id: key }),
                    ATLAS_TIMEOUT_MS,
                    () => null,
                );
                if (doc === null) return null;
                noteAtlasSuccess();
                if (doc.expires_at < Date.now()) {
                    void col()
                        .deleteOne({ _id: key })
                        .catch(() => undefined);
                    return null;
                }
                return doc.value ?? null;
            } catch {
                noteAtlasFailure();
                return null;
            }
        },
        async set(key, value, ttlSeconds) {
            if (!atlasAvailable()) return;
            const doc = { _id: key, value, expires_at: Date.now() + ttlSeconds * 1000 };
            try {
                await withTimeout(
                    col().replaceOne({ _id: key }, doc, { upsert: true }),
                    ATLAS_TIMEOUT_MS,
                    () => undefined,
                );
            } catch {
                noteAtlasFailure();
            }
        },
    };
}

/** Memory-only store. Used when Atlas is absent, and as the hot tier above it. */
export const memoryCacheStore: CacheStore = {
    async get(key) {
        const hit = memory.get(key);
        if (!hit) return null;
        if (hit.expires_at < Date.now()) {
            memory.delete(key);
            return null;
        }
        return hit.value;
    },
    async set(key, value, ttlSeconds) {
        memory.set(key, { value, expires_at: Date.now() + ttlSeconds * 1000 });
    },
};

/**
 * Read-through cache. The memory tier is consulted first, then the durable store.
 * A failure in the durable tier is swallowed — a cache miss must never become a
 * request failure.
 */
export function cached<T>(
    key: string,
    ttlSeconds: number,
    durable: CacheStore,
    produce: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
    return (async () => {
        const hot = await memoryCacheStore.get(key);
        if (hot !== null) return { value: hot as T, hit: true };

        try {
            const cold = await durable.get(key);
            if (cold !== null) {
                await memoryCacheStore.set(key, cold, ttlSeconds);
                return { value: cold as T, hit: true };
            }
        } catch {
            // Fall through to producing. A broken cache is not a broken app.
        }

        const value = await produce();
        await memoryCacheStore.set(key, value, ttlSeconds);
        try {
            await durable.set(key, value, ttlSeconds);
        } catch {
            // Same reasoning. Steady-state memory only is still correct.
        }
        return { value, hit: false };
    })();
}

export function cacheStoreFor(db: Db | null): CacheStore {
    return db ? mongoCacheStore(db) : memoryCacheStore;
}