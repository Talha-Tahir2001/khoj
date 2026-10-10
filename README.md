# Khoj

**Decide which Saturday is worth the drive.**

Khoj scores hiking conditions for six trails in northern Pakistan, explains every score, and tells you what actually happened on past days that felt the same. Open-weight models run on your device.

Built for the [Hacktoberfest Open-Source AI Challenge, Week 1 — *Touch Grass*](https://dev.to/challenges/hacktoberfest-week1-2026-10-05).

> **Live demo:** _coming soon_
> **Post:** _coming soon_

---

## The problem

Deciding "should I go hiking this weekend?" in northern Pakistan is guesswork. Post-monsoon mud, ridge wind, and first snow above 3,000 m can each close a trail, and Babusar is a six-hour drive either way. Finding out at the trailhead is a wasted day.

Generic weather apps forecast the city. They are meaningless for a ridge 2,000 m above it.

## How it works

1. Pick a trail and a date range
2. Get a verdict per day — **GO / MAYBE / NO** — with named contributing reasons
3. See past days with similar conditions and what was actually reported
4. Hear a 3-sentence spoken brief
5. Close the browser

## The honest version

**The score is arithmetic, not a model.** Every penalty maps to a real October hazard — mud, wind, heat, valley fog, early snow on Babusar — and each one is unit-tested in isolation. If the app says NO, you can see exactly which term did it.

You should be able to audit a number before skipping a six-hour drive for it. A model could not give you that.

**The open-weight model does retrieval.** Matching "muddy after rain, stream crossing high" against stored observations is not something a lookup table can do. [EmbeddingGemma](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX) (Google's open embedding model, ONNX) runs **in your browser** via [Transformers.js](https://github.com/huggingface/transformers.js) — the raw text never leaves your device, only a 768-float vector.

Gemma 3 then writes the spoken brief. It is **given** the score; it never computes one.

## Stack

| Layer | Choice |
|---|---|
| Client | React 19, TypeScript, Vite 8, Tailwind 4, shadcn/ui (Base UI) |
| Local model | EmbeddingGemma-300M via Transformers.js (ONNX, WebGPU → WASM) |
| API | Hono on Node 24 |
| Data | MongoDB Atlas (`$vectorSearch`), Open-Meteo (no key required) |
| AI | Gemma 3 (Google Cloud) for briefs, ElevenLabs for speech |
| Obs | Sentry `gen_ai.*` spans |
| Deploy | Render Static Site + Render Web Service |

No Python anywhere in the runtime. One language, end to end.

## What is actually verified

Rather than claim these work, they were run:

| Claim | How it was checked | Result |
|---|---|---|
| Six trails score with visible penalties | Live request per trail | Babusar scores **NO (41)** on 2026-10-14 with `snowPenalty=35`; Daman-e-Koh stays **100** for the same forecast |
| Elevation scales the snow penalty | Same forecast, two elevations | Non-zero at 3,800 m, null at 1,300 m |
| EmbeddingGemma emits 768 dims | Model loaded and run | **768** — the Atlas `numDimensions` is correct |
| Vector survives the base64 hop | 768 floats → 4,096 chars → decode | Exact, first element matches to 1e-7 |
| Retrieval beats keyword search | Side-by-side, same queries | Muddy query: keyword returns unrelated Murree notes; embedding returns the three actually-muddy trails at **0.94 / 0.81 / 0.80** |
| Retrieval is non-empty for all six trails | `npm run verify:trails` | **G2 PASS** |
| Caching works | Two identical requests | `X-Cache: MISS` then `HIT` |
| Error contract holds | Four bad requests | `UNKNOWN_TRAIL`, `INVALID_DAYS`, `INVALID_EMBEDDING` all correct |
| Zero known vulnerabilities | `npm audit` | **0 vulnerabilities** |
| Tests pass | `npm test` | **72 passed** |

## Quick start

```bash
git clone <repo-url>
cd khoj
npm install          # npm workspaces — installs client, server, shared

cp .env.example .env # then fill in the keys you have

npm run dev:server   # Hono API on :3000
npm run dev:client   # Vite on :5173, proxies /api → :3000
```

### Environment

The app degrades gracefully. `MONGO_URI` is the only variable with real work to
do; every other key has a defined fallback and the response says which path ran.

| Variable | Required | If missing |
|---|---|---|
| `MONGO_URI` | for `$vectorSearch` + cross-restart cache | Keyword-match retrieval, in-memory cache |
| `GEMINI_API_KEY` | no | Rule-based brief from the same numbers |
| `ELEVENLABS_API_KEY` | no | Text brief, no audio |
| `SERPAPI_KEY` | no | Live-reports section omitted entirely |
| `SENTRY_DSN` | no | No `gen_ai.*` traces |
| `PUBLIC_SITE_ORIGIN` | in production | CORS rejects the static site |

The app **starts and serves** with an empty `.env`. That is deliberate — on a
short deadline, a missing key must never mean a blank screen.

### Verification scripts

```bash
npm run verify:trails      # G2: retrieval returns non-empty for all six trails
npm run verify:retrieval   # semantic vs keyword retrieval, side by side
npm run seed:atlas         # embed the corpus + create the Atlas vector index
```

`verify:trails` loads the real EmbeddingGemma model and asserts that each
trail's own observation comes back first when used as its own query. It is a
gate, not a demo: it exits non-zero if any trail retrieves nothing.

## Tests

```bash
npm test
```

72 tests. The scoring suite is the important one — it proves each penalty fires
in isolation and never fires below its threshold, which is what makes the score
auditable. The rest cover the mud lookback window, the conditions text that both
client and server must agree on, the rule-based brief, and the retrieval
fallbacks.

## Docs

| Doc | What's in it |
|---|---|
| [PLAN.md](PLAN.md) | Build plan, gates, risks, cut list |
| [PRD.md](PRD.md) | Requirements and design decisions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Two-service split, request lifecycle, caching |
| [docs/DATA.md](docs/DATA.md) | Open-Meteo schema, corpus format, trail catalog |
| [docs/API.md](docs/API.md) | Endpoint contracts |
| [docs/POST_DRAFT.md](docs/POST_DRAFT.md) | DEV submission draft |
| [docs/JUDGING_MAP.md](docs/JUDGING_MAP.md) | Criteria → evidence |
| [THIRD_PARTY.md](THIRD_PARTY.md) | Licenses and weight provenance |

## Limitations

Stated plainly, because they'd otherwise cost your trust:

- **The score is deterministic rules.** The model does retrieval and narration
  only. It never computes a score, and it is given one.
- **The observation corpus is small and hand-seeded** — 24 records, four per
  trail. Retrieval works; it is not robust, and its quality is bounded by that
  size. Your own first-hand notes are worth more than anything generated here.
- **The penalty thresholds are plausible, not calibrated.** Nobody has a
  labelled dataset of "did this hike go well" for these trails.
- **Mountain forecasts are reanalysis-derived** and are the hardest case for
  Open-Meteo. Babusar at 3,800 m is the least reliable row in the app.
- **Open-Meteo forecast skill degrades beyond ~10 days.** The 16-day view is
  shown honestly, but it is a guess that far out and the UI should weight it
  lower. It does not yet.
- **Thunderstorms are not scored** (codes 95–99), because the source cannot
  reliably derive them. Fine in October, wrong in July.
- **The mud penalty cannot see rain before the forecast window opens.** Open-Meteo
  returns a forward-looking window only, so day 0 has zero prior rainfall. This
  is a real blind spot; retrieval partially recovers the qualitative picture.
- **Live trail reports come from web search**, and SerpApi coverage of Pakistani
  trails is thin. The section is omitted when empty rather than padded.
- **Coordinates are unverified.** See the checklist in [PLAN.md](PLAN.md).
- **Not yet done:** live deployment, the field trip, and the DEV post. See
  [PLAN.md](PLAN.md) for the gates.

## License

MIT — see [LICENSE](LICENSE).

Model weights and data carry their own terms. See [THIRD_PARTY.md](THIRD_PARTY.md) before reusing anything commercially.