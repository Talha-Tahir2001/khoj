import type { Db } from "mongodb";

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

/** Anything with a Mongo TTL index can back the durable half. */
export interface CacheStore {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/** Mongo collection-backed store. `collection` must have a TTL index on `expires_at`. */
export function mongoCacheStore(db: Db, collection = "cache"): CacheStore {
    const col = () => db.collection<CacheEntry<unknown> & { _id: string }>(collection);
    return {
        async get(key) {
            const doc = await col().findOne({ _id: key });
            if (!doc) return null;
            if (doc.expires_at < Date.now()) {
                await col().deleteOne({ _id: key });
                return null;
            }
            return doc.value ?? null;
        },
        async set(key, value, ttlSeconds) {
            const doc = { _id: key, value, expires_at: Date.now() + ttlSeconds * 1000 };
            await col().replaceOne({ _id: key }, doc, { upsert: true });
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