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

## Module map

```
shared/          @khoj/shared — imported by BOTH packages
  scoring-rules.ts   penalty constants and band thresholds
  types.ts           Trail, ScoredDay, Penalty, AdviceResponse
  trails.ts          trail catalog loader + type

client/
  embed.ts       EmbeddingGemma pipeline, WebGPU → WASM fallback
  app.ts         UI state and render
  sw.ts          service worker, offline forecast cache

server/
  index.ts       Hono app, CORS, routes
  routes/advice.ts
  routes/health.ts
  lib/scoring.ts     pure scoring functions
  lib/weather.ts     Open-Meteo fetch + normalize
  lib/atlas.ts       Mongo client, $vectorSearch
  lib/serp.ts        SerpApi + cache
  lib/brief.ts       Gemma 3 + rule fallback
  lib/voice.ts       ElevenLabs
  lib/observability.ts  Sentry init + span helpers
  lib/cache.ts       TTL wrapper
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
| Gemma call fails | Same fallback, tagged `"source": "rule"` in the response |
| No `SERPAPI_KEY` | Live reports section omitted entirely |
| SerpApi returns nothing | Section omitted — honest, not faked |
| Atlas unreachable | Retrieval returns empty; score and brief still render |
| Open-Meteo fails | 503 with a clear message — the only hard failure, since there is no score without weather |

The response always carries a `source` field per generated segment, so the UI can label a rule-based brief as such. A fallback presented as if it were model output would be dishonest.

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
- **The corpus is hand-seeded.** With six trails and a handful of observations each, retrieval quality is bounded by that size. It works; it is not robust.
- **No CI beyond the keep-warm cron.** Tests run locally. Under a normal timeline there would be a test-and-lint workflow on push.