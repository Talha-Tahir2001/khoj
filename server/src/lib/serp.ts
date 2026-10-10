import type { Config } from "./config.js";
import { hasSerpApi } from "./config.js";

export interface LiveReport {
    title: string;
    snippet: string;
    url: string;
    source: string;
}

/**
 * Live trail-condition mentions from web search.
 *
 * Realistically this returns little or nothing for Pakistani trails — see the
 * disclosure in L4. It is cached hard against a 250-search budget and the caller
 * omits the section entirely when it comes back empty. A fabricated result
 * would be worse than no section at all.
 */
export async function searchLiveReports(
    config: Config,
    trailName: string,
): Promise<LiveReport[]> {
    if (!hasSerpApi(config)) return [];

    try {
        const url = new URL("https://serpapi.com/search.json");
        url.searchParams.set("engine", "google_news");
        url.searchParams.set("q", `${trailName} trail conditions`);
        url.searchParams.set("gl", config.SERPAPI_GL);
        url.searchParams.set("hl", "en");
        // Without this the request is unauthenticated and returns nothing —
        // silently, since SerpApi answers 200 with an empty body.
        url.searchParams.set("api_key", config.SERPAPI_KEY!);

        const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
        if (!res.ok) {
            console.warn(`[serp] ${res.status} for "${trailName}"`);
            return [];
        }

        const body = (await res.json()) as {
            news_results?: Array<{ title?: string; snippet?: string; link?: string }>;
        };

        return (body.news_results ?? [])
            .filter((r) => r.title && r.link)
            .slice(0, 4)
            .map((r) => ({
                title: r.title!,
                snippet: r.snippet ?? "",
                url: r.link!,
                source: "serpapi",
            }));
    } catch {
        return [];
    }
}