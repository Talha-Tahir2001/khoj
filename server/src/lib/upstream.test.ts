import { afterEach, describe, expect, it } from "vitest";
import {
    isHardFailure,
    noteFailure,
    noteOk,
    noteStatusFailure,
    reasonFor,
    resetUpstreams,
    shouldTry,
} from "./upstream.js";

describe("upstream circuit breaker", () => {
    afterEach(() => resetUpstreams());

    it("tries an upstream it has never seen", () => {
        expect(shouldTry("gemini")).toBe(true);
        expect(reasonFor("gemini")).toBeUndefined();
    });

    it("keeps trying through a single failure", () => {
        noteFailure("gemini", "credits exhausted");
        expect(shouldTry("gemini")).toBe(true);
    });

    /**
     * A 402 will not fix itself by being asked again. Retrying it per request
     * adds latency to every call and produces the outbound pattern Render may
     * suspend a free instance for.
     */
    it("stops trying after repeated failures", () => {
        noteFailure("gemini", "credits exhausted");
        noteFailure("gemini", "credits exhausted");
        expect(shouldTry("gemini")).toBe(false);
    });

    it("reports the reason while it is disabled", () => {
        noteFailure("elevenlabs", "ElevenLabs free-tier quota exhausted.");
        noteFailure("elevenlabs", "ElevenLabs free-tier quota exhausted.");
        expect(reasonFor("elevenlabs")).toBe("ElevenLabs free-tier quota exhausted.");
    });

    it("recovers when the upstream succeeds again", () => {
        noteFailure("gemini", "credits exhausted");
        noteFailure("gemini", "credits exhausted");
        expect(shouldTry("gemini")).toBe(false);

        noteOk("gemini");
        expect(shouldTry("gemini")).toBe(true);
        expect(reasonFor("gemini")).toBeUndefined();
    });

    it("keeps upstreams independent", () => {
        noteFailure("gemini", "credits exhausted");
        noteFailure("gemini", "credits exhausted");

        expect(shouldTry("gemini")).toBe(false);
        // One dead paid service must not disable the free ones.
        expect(shouldTry("serpapi")).toBe(true);
        expect(shouldTry("elevenlabs")).toBe(true);
    });

    it("a success resets the consecutive failure count", () => {
        noteFailure("gemini", "transient");
        noteOk("gemini");
        noteFailure("gemini", "transient");
        expect(shouldTry("gemini")).toBe(true);
    });

    /**
     * A 402 will not fix itself by being asked again, so it must not cost a
     * second slow request. Transient failures still get the benefit of the doubt.
     */
    it("trips on the first hard failure, not the second", () => {
        noteStatusFailure("gemini", 402, "credits exhausted");
        expect(shouldTry("gemini")).toBe(false);
    });

    it("still gives transient failures two strikes", () => {
        noteStatusFailure("gemini", 500, "upstream error");
        expect(shouldTry("gemini")).toBe(true);
        noteStatusFailure("gemini", 500, "upstream error");
        expect(shouldTry("gemini")).toBe(false);
    });
});

describe("isHardFailure", () => {
    it("treats auth and quota errors as permanent", () => {
        expect(isHardFailure(401)).toBe(true);
        expect(isHardFailure(402)).toBe(true);
        expect(isHardFailure(403)).toBe(true);
    });

    it("does not treat transient errors as permanent", () => {
        expect(isHardFailure(429)).toBe(false);
        expect(isHardFailure(500)).toBe(false);
        expect(isHardFailure(503)).toBe(false);
    });
});