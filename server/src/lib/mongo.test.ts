import { afterEach, describe, expect, it } from "vitest";
import {
    atlasAvailable,
    noteAtlasFailure,
    noteAtlasSuccess,
    resetAtlasBreaker,
    withTimeout,
} from "./mongo.js";

/**
 * Atlas is optional. The failure it must never produce is a hung request.
 *
 * These existed because the first version of this app would sit for the full
 * driver timeout when the SRV lookup stalled, rather than degrading.
 */
describe("withTimeout", () => {
    it("passes the value through when the promise resolves in time", async () => {
        const value = await withTimeout(Promise.resolve("ok"), 1000, () => "fallback");
        expect(value).toBe("ok");
    });

    it("returns the fallback when the promise never settles", async () => {
        const stalled = new Promise<string>(() => {
            /* never resolves */
        });
        const started = Date.now();
        const value = await withTimeout(stalled, 50, () => "fallback");
        expect(value).toBe("fallback");
        expect(Date.now() - started).toBeLessThan(1000);
    });

    it("returns the fallback when the promise is merely slow", async () => {
        const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 400));
        expect(await withTimeout(slow, 50, () => "fallback")).toBe("fallback");
    });

    it("propagates a real rejection rather than masking it as a timeout", async () => {
        await expect(
            withTimeout(Promise.reject(new Error("atlas down")), 1000, () => "fallback"),
        ).rejects.toThrow("atlas down");
    });

    it("propagates an error thrown by the fallback", async () => {
        await expect(
            withTimeout(new Promise<string>(() => {}), 30, () => {
                throw new Error("UPSTREAM_TIMEOUT");
            }),
        ).rejects.toThrow("UPSTREAM_TIMEOUT");
    });

    it("does not leak a timer that outlives the response", async () => {
        // A dangling timer keeps the event loop alive and, in a server, holds
        // the response open. Clearing on settle is what prevents that.
        const started = Date.now();
        await withTimeout(new Promise<string>((r) => setTimeout(() => r("done"), 20)), 5000, () => "x");
        expect(Date.now() - started).toBeLessThan(1000);
    });
});

describe("Atlas circuit breaker", () => {
    afterEach(() => resetAtlasBreaker());

    it("is closed while Atlas is healthy", () => {
        expect(atlasAvailable()).toBe(true);
    });

    /**
     * The cost of a dead cluster is per-attempt, not per-failure: without a
     * breaker every request pays the full timeout forever. These pin the
     * behaviour that makes degradation take 0 s instead of 4 s.
     */
    it("stays closed through a single failure", () => {
        noteAtlasFailure();
        expect(atlasAvailable()).toBe(true);
    });

    it("opens after repeated failures", () => {
        noteAtlasFailure();
        noteAtlasFailure();
        expect(atlasAvailable()).toBe(false);
    });

    it("closes again after a success", () => {
        noteAtlasFailure();
        noteAtlasFailure();
        expect(atlasAvailable()).toBe(false);

        resetAtlasBreaker();
        noteAtlasSuccess();
        expect(atlasAvailable()).toBe(true);
    });

    it("a success resets the failure count", () => {
        noteAtlasFailure();
        noteAtlasSuccess();
        noteAtlasFailure();
        expect(atlasAvailable()).toBe(true);
    });
});