import { MongoClient, type Db } from "mongodb";
import type { Config } from "./config.js";
import { loadConfig } from "./config.js";
import { applyDnsOverride } from "./dns.js";

/**
 * Mongo client lifecycle. Lazily connected so tests and the scoring suite never
 * open a socket, and so a missing MONGO_URI degrades instead of crashing.
 */

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Atlas is optional, so it must never be able to hang a request.
 *
 * `serverSelectionTimeoutMS` bounds server *selection* but does not reliably
 * bound the SRV DNS lookup — a blocked or slow resolver can sit far past it. The
 * first version of this app had exactly that failure: a request would sit for
 * the full client timeout rather than degrading, which is the worst outcome for
 * a tool someone is opening in a car park.
 *
 * So: bound the selection aggressively, and bound every call site with
 * `withTimeout` as well. Belt and braces, because the failure mode is a hung
 * request.
 */
const ATLAS_CALL_TIMEOUT_MS = 4000;

export function getDb(config: Config = loadConfig()): Db | null {
    if (!config.MONGO_URI) return null;
    if (db) return db;

    // Applied here rather than at module scope: this is the first point where a
    // client is about to exist, and it is guaranteed to run AFTER dotenv has
    // populated process.env. Doing it at import time read an empty env and
    // silently did nothing.
    //
    // It must happen before the SRV lookup, which happens on first use — not at
    // construction — so this is early enough.
    applyDnsOverride(process.env.DNS_SERVERS);

    client = new MongoClient(config.MONGO_URI, {
        serverSelectionTimeoutMS: ATLAS_CALL_TIMEOUT_MS,
        connectTimeoutMS: ATLAS_CALL_TIMEOUT_MS,
        // Bound the socket itself, so a half-open connection cannot stall a read.
        socketTimeoutMS: ATLAS_CALL_TIMEOUT_MS,
    });
    db = client.db(config.MONGO_DB);
    return db;
}

/**
 * Race a promise against a timer.
 *
 * Used at every Atlas call site so a slow cluster degrades to the in-memory
 * cache and keyword search instead of holding the request open. The losing
 * promise is not cancelled — there is nothing to cancel it with — but it is
 * detached, so its eventual rejection cannot become an unhandled rejection.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            try {
                resolve(onTimeout());
            } catch (err) {
                reject(err);
            }
        }, ms);

        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err: unknown) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}

export const atlasTimeoutMs = ATLAS_CALL_TIMEOUT_MS;

/**
 * Circuit breaker.
 *
 * A dead or DNS-blocked cluster is expensive in a specific way: every attempt
 * costs the full timeout, so every request pays it. After a couple of failures
 * the cluster is marked unavailable and Atlas is skipped entirely for a cool-off
 * window, letting the app run on the in-memory cache and keyword search at full
 * speed.
 *
 * This is the difference between degrading in 4 s and degrading in 0 s.
 */
let failures = 0;
let openedAt = 0;

const FAILURE_THRESHOLD = 2;
const COOLOFF_MS = 60_000;

export const atlasAvailable = (): boolean => {
    if (failures < FAILURE_THRESHOLD) return true;
    if (Date.now() - openedAt > COOLOFF_MS) {
        // Half-open: let one request through to test the water.
        failures = FAILURE_THRESHOLD - 1;
        return true;
    }
    return false;
};

export const noteAtlasSuccess = (): void => {
    failures = 0;
};

export const noteAtlasFailure = (): void => {
    failures += 1;
    if (failures >= FAILURE_THRESHOLD) openedAt = Date.now();
};

/** Reset for tests. */
export const resetAtlasBreaker = (): void => {
    failures = 0;
    openedAt = 0;
};

export async function closeDb(): Promise<void> {
    if (client) await client.close();
    client = null;
    db = null;
}