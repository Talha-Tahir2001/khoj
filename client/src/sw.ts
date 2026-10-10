/// <reference lib="webworker" />

/**
 * Offline layer.
 *
 * The app is used to make a six-hour driving decision, and people check it in
 * car parks with patchy signal. So the shell and the last-fetched advice are
 * cached, and the staleness is stated plainly.
 *
 * What this deliberately does NOT do is re-score offline. Cached weather shown
 * without a staleness marker would be worse than an empty screen, because the
 * user has no way to tell it apart from a live answer.
 */

const VERSION = "khoj-v1";
const SHELL = `${VERSION}-shell`;
const ADVICE = `${VERSION}-advice`;

const SHELL_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg"];

declare const self: ServiceWorkerGlobalScope;

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(SHELL)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => !k.startsWith(VERSION))
                        .map((k) => caches.delete(k)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Only our own API. Cross-origin calls (the model CDN) are left alone so the
    // browser HTTP cache handles them normally.
    if (url.origin === self.location.origin && url.pathname.startsWith("/api/advice")) {
        event.respondWith(adviceStrategy(request));
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(navigationStrategy(request));
    }
});

/**
 * Network-first with a cache fallback.
 *
 * Network-first rather than cache-first because a stale forecast presented as
 * live is the failure mode this whole design is trying to avoid. When the
 * network fails, the cached copy is served with a header marking it as cached,
 * and the UI shows the timestamp.
 */
async function adviceStrategy(request: Request): Promise<Response> {
    const cache = await caches.open(ADVICE);
    try {
        const response = await fetch(request);
        if (response.ok) {
            const headers = new Headers(response.headers);
            headers.set("X-Khoj-Cache", "MISS");
            const tagged = new Response(await response.clone().arrayBuffer(), {
                status: response.status,
                statusText: response.statusText,
                headers,
            });
            void cache.put(request, tagged.clone());
            return response;
        }
        throw new Error(`upstream returned ${response.status}`);
    } catch {
        const hit = await cache.match(request);
        if (hit) {
            const headers = new Headers(hit.headers);
            headers.set("X-Khoj-Cache", "HIT");
            return new Response(await hit.arrayBuffer(), {
                status: hit.status,
                statusText: hit.statusText,
                headers,
            });
        }
        return new Response(
            JSON.stringify({
                error: true,
                code: "OFFLINE",
                message: "Offline and nothing cached for this trail yet.",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
        );
    }
}

/** Cache-first for the shell, so the app opens instantly off the CDN or offline. */
async function navigationStrategy(request: Request): Promise<Response> {
    const cache = await caches.open(SHELL);
    const hit = await cache.match("/index.html");
    if (hit) {
        // Refresh in the background; do not block first paint on the network.
        void fetch(request)
            .then(async (res) => {
                if (res.ok) await cache.put("/index.html", res.clone());
            })
            .catch(() => undefined);
        return hit;
    }
    try {
        return await fetch(request);
    } catch {
        return new Response("Offline", { status: 503 });
    }
}

export {};