# Architecture

## The one-paragraph version

Two Render services from one repo. A **Static Site** serves the built React PWA over CDN — instant, never sleeps. A **Web Service** runs the Hono API, holds every API key, and does caching. They never ship together. The client runs an open-weight embedding model in the browser; the server never sees raw condition text.

---

## Why two services

The obvious move is a single Node server serving both API and static files. Rejected for three reasons:

**1. Cold start.** Render's free tier is **0.1 CPU / 512 MB**. Free instances also spin down after 15 minutes idle, and Render shows a loading page while one wakes — roughly a minute. With a single service, that boot happens *before first paint*. A judge clicking the link sees a spinner.

With the split, the shell comes off the CDN instantly even while the API is asleep. They see the trail list immediately; only the verdict call is slow.

**2. The static shell is genuinely static.** It has no server dependency. Putting it on a Static Site is strictly better than serving it from the app process.

**3. Keep-alive only costs what it should.** The cron keeps the *Web Service* awake. It has no work to do on a Static Site.

---

## The privacy property

This is the constraint that shaped everything else.

```
┌─ Browser ────────────────────────────────────────────┐
│                                                    │
│  "muddy after rain, stream high, 18°C"             │
│         │                                          │
│         ▼                                          │
│  EmbeddingGemma-300M (Transformers.js, ONNX)        │
│         │                                          │
│         ▼                                          │
│  768-float vector ─────────────┐                    │
│                                │  raw text does     │
└────────────────────────────────┼──── NOT cross ────┘
                                 │
┌────────────────────────────────▼─ Web Service ─────┐
│  Atlas $vectorSearch  ← k similar conditions       │
│  Open-Meteo  → deterministic score                 │
│  SerpApi     → live reports (cached)               │
│  Gemma 3     → brief (given the score, not shown    │
│                 the vector)                        │
│  ElevenLabs  → audio                               │
└────────────────────────────────────────────────────┘
```

The server receives a vector and a trail ID. It cannot reconstruct "what the weather is like on my drive home," and it never learns where you are — there is no location input at all beyond the trail you selected from a public list.

This is worth stating plainly in the post. It is a real architectural constraint, not a marketing line, and it is the thing the ten bird-call entries cannot say.

---

## Request lifecycle

`GET /api/advice?trail=galiyat&days=7`

```
1. Cache lookup (Atlas, TTL 1h)
   └─ hit → return cached response, exit

2. Open-Meteo forecast fetch → 16 daily rows

3. scoreDay() per row  [pure, synchronous, no I/O]
   → { score, band, penalties[] }

4. SerpApi live reports [Atlas cache, TTL 12h]
   └─ skip entirely if SERPAPI_KEY absent

5. Compose prompt from score + penalties + live reports
   → Gemma 3 → 3-sentence brief
   └─ if GEMINI_API_KEY absent → rule-based brief fallback

6. Sentry spans close → latency + token counts recorded

7. Cache response (TTL 1h) → return
```

**The embedding vector is computed client-side** and sent alongside the request. Retrieval (step 4 in the diagram above) happens on the server.

---

## The two-call flow, and why

Retrieval needs a vector, and the vector comes from a model that downloads ~300 MB
on first use. Making that a gate on first paint would mean a judge on a mid-range
Android watches a spinner before seeing anything.

So the client makes **two calls**:

```
1. GET /api/advice?trail=galiyat&days=7
   → scored days render immediately. The verdict is the product.

2. Embed the focal day's condition sentence, LOCALLY
   → 768 floats

3. GET /api/advice?trail=galiyat&days=7&embedding=…
   → same cached forecast, now with real vector retrieval
```

The model also warms up ~1.5 s after load, while the user is still reading the
trail list. The upside is not latency — it is that **the app is fully useful on
first paint and offline**, and the model is an enhancement rather than a
prerequisite. If local inference fails outright, step 2 returns null, the second
call never happens, and the server falls back to keyword match.

The server-side keyword fallback exists for exactly this. It is on the cut list,
and it is visibly worse — which the UI says out loud rather than hiding.

---

## Module map

```
shared/          @khoj/shared — imported by BOTH packages
  scoring-rules.ts   penalty constants and band thresholds
  types.ts           Trail, ScoredDay, Penalty, AdviceResponse
  index.ts           barrel

data/            committed JSON, no build step
  trails.json        the catalog — adding a trail is a data-only change (FR8)
  conditions.json    the observation corpus retrieval searches

scripts/
  seed-atlas.ts      embed the corpus, create the Atlas vector index
  verify-trails.ts   G2 gate: retrieval non-empty for every trail
  verify-retrieval.ts  semantic vs keyword, side by side

client/src/
  api.ts             fetch wrapper, the two-call advice flow
  embed.ts           EmbeddingGemma pipeline, WebGPU → WASM fallback
  offline.ts         last-fetched cache, read on failure
  sw.ts              service worker, network-first for advice
  App.tsx            UI state and render
  components/        day-card, brief-panel, similar-panel

server/src/
  index.ts           Hono app, CORS, routes
  routes/advice.ts   the orchestrator — every upstream, in order
  routes/health.ts   liveness probe
  lib/scoring.ts     pure scoring functions
  lib/scorer.ts      pluggable Scorer registry (TabPFN slot kept open)
  lib/data.ts        trail + corpus loaders, validated with zod
  lib/weather.ts     Open-Meteo fetch + normalize + prior-rainfall
  lib/atlas.ts       $vectorSearch + keyword fallback
  lib/brief.ts       Gemma brief, grounded, never invents numbers
  lib/conditions.ts  scored day → embeddable sentence (mirrored client-side)
  lib/voice.ts       ElevenLabs
  lib/serp.ts        SerpApi
  lib/observability.ts  Sentry init + gen_ai.* span helpers
  lib/cache.ts       two-tier TTL cache
  lib/mongo.ts       lazy client
  lib/config.ts      zod-validated env, every key defaulted
```

### Why `shared/` is source-only

`shared/package.json` points `"main": "src/index.ts"` — raw TypeScript, no build step. Vite compiles it for the client; `tsx` compiles it for the server.

This matters more than it looks. The band thresholds (`GO ≥ 70`) exist in exactly one place, so the client and server **cannot** disagree about what "GO" means. A silent divergence there would show a green verdict in the UI that the API never agreed to.

---

## Caching

Not a performance optimization — a **suspension risk mitigation**. Render may suspend a free instance that "initiates an uncomably high volume of traffic over the public internet," and invoking external APIs is explicitly listed as such. Four upstream calls per request is that pattern.

| Data | TTL | Notes |
|---|---|---|
| Full advice response | 1 h | Matches Open-Meteo update cadence |
| Open-Meteo raw | 1 h | |
| SerpApi results | 12 h | You have 250 searches total. Cache is mandatory. |
| Briefs | 24 h | |
| Embeddings | permanent | Content-addressed by condition text |

Steady-state outbound traffic: near zero.

## Error handling

Every external dependency has a defined failure mode. The app is never left spinning.

| Failure | Behavior |
|---|---|
| No `GEMINI_API_KEY` | Rule-based brief from the same score |
| Gemma call fails | Same fallback, with the reason in `meta.reasons.brief` |
| No `SERPAPI_KEY` | Live reports section omitted entirely |
| SerpApi returns nothing | Section omitted — honest, not faked |
| Atlas unreachable | Retrieval returns empty; score and brief still render |
| Open-Meteo fails | 503 — the only hard failure, since there is no score without weather |
| Any upstream > 20 s | 504 rather than hanging |
| Voice unavailable | Brief is text-only; reason in `meta.reasons.audio` |

The response always carries a `source` field per generated segment, so the UI can label a rule-based brief as such. A fallback presented as if it were model output would be dishonest.

### `meta.reasons` — why, not just that

`degraded: true` on its own is undiagnosable. A quota exhaustion and a network
blip need completely different responses from whoever is reading it, so each
degradation carries a sentence:

```json
"reasons": {
  "brief": "Gemini API credits are exhausted — the brief falls back to rules.",
  "audio": "ElevenLabs free-tier quota exhausted — top up or the brief stays text-only."
}
```

### Circuit breakers

A service returning 402 or 401 will never start working by being asked again.
Retrying it per request added latency to every call and produced exactly the
outbound-traffic pattern Render may suspend a free instance for.

- **Hard failures** (401/402/403) trip the breaker on the **first** occurrence.
  They are deterministic; a second attempt cannot change the answer.
- **Transient failures** (timeouts, 5xx) get two strikes, so a brief blip does
  not permanently disable a feature.
- A 5-minute cool-off, then one half-open attempt to test the water.

Measured effect on this project: cold request **25 s → 5.9 s**, warm
**322 ms**. Without it, every request paid the full timeout forever.

### Timeouts

Atlas is optional, so it must never be able to hang a request.
`serverSelectionTimeoutMS` bounds server *selection* but does **not** reliably
bound the SRV DNS lookup — a stalled resolver sits far past it. That produced a
31-second hang before any timeout applied.

| Bound | Value |
|---|---|
| Atlas operation | 4 s |
| Speech synthesis | 5 s, retries **off** |
| SerpApi | 12 s |
| Gemma | 10 s |
| Whole request | 20 s → 504 |

SDK-level retries are disabled. Both the ElevenLabs and Google SDKs retry on
their own, which turned a 660 ms rejection into a 17 s wait.

`Server-Timing` breaks the request down per stage, so a slow response can be
attributed without attaching a debugger — and it produces the latency table the
write-up needs.

## Sentry span structure

```
gen_ai.invoke_agent  "invoke_agent Khoj Planner"     (parent)
├── gen_ai.chat       "chat <model>"          gen_ai.request.model
│                                            gen_ai.response.model
│                                            tokens, latency
├── gen_ai.execute_tool  "execute_tool get_forecast"
└── gen_ai.execute_tool  "execute_tool search_live_reports"
```

`set_conversation_id()` per session so multi-turn activity groups into one Conversation view. Required attributes set **at span start** — before the call — so head-based sampling can use them.

This produces the latency and token table the write-up needs. It is instrumentation, not decoration.

## Deployment

```yaml
# render.yaml
services:
  - type: static        # PWA shell — CDN, instant, never sleeps
    buildCommand: npm run build -w client
    staticPublishPath: ./client/dist

  - type: web           # Hono API
    runtime: docker
    dockerfilePath: ./Dockerfile
    healthCheckPath: /api/health
```

```yaml
# .github/workflows/keep-warm.yml
on:
  schedule:
    - cron: '*/10 * * * *'    # free on public repos
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -fsS ${{ secrets.KHOJ_HEALTH_URL }}
```

The cron must target `/api/health` specifically. Render intercepts `/robots.txt` while spun down and that request **does not** trigger a wake-up.

## Offline behaviour

The service worker caches the last-fetched advice response. With the network off, the app renders from cache with an explicit staleness banner showing the fetch timestamp.

It does **not** pretend to re-score. Refusing to silently show stale weather as current is the correct behaviour for a tool someone uses to make a six-hour driving decision.

## Technical debt, recorded honestly

- **Scoring rules are hand-tuned constants, not calibrated.** The thresholds are plausible, not fitted to labelled outcomes. Calibrating them properly is the obvious next step and would need ground truth nobody has collected yet.
- **The corpus is hand-seeded.** 24 records, four per trail. Retrieval quality is bounded by that size. It works; it is not robust.
- **The mud penalty cannot see rain before the forecast window opens.** Open-Meteo returns a forward-looking window, so day 0 always scores zero prior rainfall. Fixing it needs a separate historical call per trail.
- **Retrieval is scoped to one trail at a time.** The Atlas `$vectorSearch` filters by trail, so "days that felt like this *on this trail*" is what you get. A cross-trail search would be more interesting and would need a different index strategy.
- **`conditionsText` is duplicated client- and server-side.** That is deliberate — the client must build the sentence to keep the text local — but it means the two copies can drift. There is a test pinning the server behaviour; the client copy is the one that could rot.