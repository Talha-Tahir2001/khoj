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

The app degrades gracefully. Only `MONGO_URI` is required.

| Variable | Required | If missing |
|---|---|---|
| `MONGO_URI` | yes | App will not start |
| `GEMINI_API_KEY` | no | Falls back to a rule-based brief |
| `SERPER_API_KEY` / `SERPAPI_KEY` | no | Live reports section hidden |
| `ELEVENLABS_API_KEY` | no | Text brief only, no audio |
| `SENTRY_DSN` | no | No traces |

## Tests

```bash
npm test
```

The scoring suite is the important one — it proves each penalty fires in isolation, which is what makes the score auditable.

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

- The score is deterministic rules. The model does retrieval and narration only.
- The observation corpus is small and hand-seeded; retrieval quality is bounded by its size.
- Mountain forecasts are reanalysis-derived and are the hardest case for Open-Meteo.
- Open-Meteo forecast skill degrades beyond ~10 days.
- Live trail reports come from web search and coverage for Pakistani trails is thin.

## License

MIT — see [LICENSE](LICENSE).

Model weights and data carry their own terms. See [THIRD_PARTY.md](THIRD_PARTY.md) before reusing anything commercially.