import { MongoClient, type Db } from "mongodb";
import type { Config } from "./config.js";
import { loadConfig } from "./config.js";

/**
 * Mongo client lifecycle. Lazily connected so tests and the scoring suite never
 * open a socket, and so a missing MONGO_URI degrades instead of crashing.
 */

let client: MongoClient | null = null;
let db: Db | null = null;

export function getDb(config: Config = loadConfig()): Db | null {
    if (!config.MONGO_URI) return null;
    if (db) return db;
    client = new MongoClient(config.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
    });
    db = client.db(config.MONGO_DB);
    return db;
}

export async function closeDb(): Promise<void> {
    if (client) await client.close();
    client = null;
    db = null;
}