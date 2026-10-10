# Khoj — Build Plan

**Challenge:** Hacktoberfest Open-Source AI Challenge Week 1 — *Touch Grass*
**Deadline:** 2026-10-11 23:59 PDT (2026-10-12 06:59 UTC)

---

## Decision log

Decisions made and why. Referenced by later phases; change them here first.

| Decision | Rationale |
|---|---|
| Strict TypeScript, no Python in runtime | One language end to end. TabPFN was the only blocker and it was dropped. |
| TabPFN **dropped** from the core | No JS/TS runtime exists (PyTorch-only). Its REST API is a metered vendor call, which undercuts the "open-source AI at the core" criterion. A pluggable `Scorer` interface keeps the option open at zero cost. |
| EmbeddingGemma-300M runs **client-side** | Google's open-weight embedding model, ONNX, runs via Transformers.js in the browser. Raw condition text never leaves the device — only a 768-float vector does. This is the load-bearing privacy property. |
| Two Render services | Static Site (CDN shell, instant, never sleeps) + Web Service (API). Collapsing to one Node process would put cold-start boot before first paint. |
| Keep-alive cron | Free Render instances sleep after 15 min idle. A GitHub Actions ping every 10 min holds it open. |
| Deterministic scoring, learned retrieval | The numeric score is rules, not a model — traceable and testable. The *model* does semantic retrieval over real past conditions, which a lookup table cannot do. |
| Client: React 19 + Tailwind 4 + shadcn/Base UI | Already scaffolded. Familiar; the fiddly parts are elsewhere. |
| API: Hono | Tiny surface (~10 lines for our two routes). Good TS types matter for the Atlas/Sentry/Gemini SDKs. |
| npm workspaces | One install, one `node_modules`, and `@khoj/shared` importable by name from both packages. |

### Rejected

- **Next.js** — loses the static/API split, adds cold-start cost on 0.1 CPU / 512 MB, and makes the hand-written service worker fight App Router caching.
- **TabPFN via REST** — see above. Revisit only if ahead of schedule *and* honest about it being a vendor call.
- **Local model inference via Ollama** — requires Python. Out of scope.

---

## Gates

Each gate is an abort-and-cut trigger. If a gate is missed at its time, execute the cut list rather than compressing everything.

| Gate | Condition | Time |
|---|---|---|
| **G1** | `shared/scoring.ts` + unit tests green | T+3h |
| **G2** | Vector retrieval returns non-empty for all six trails | T+6h |
| **G3** | Live URL responding | T+12h |
| **G4** | Field trip completed, photos + notes on disk | T+15h |
| **G5** | Post draft complete | T+20h |

**G3 and G4 are the ones that actually decide the entry.** Everything else is negotiable; a dead demo link and a missing field report are what separate a completion badge from a placing one.

---

## Phases

### P0 — Parallel setup · T+0 → T+1 · owner: user

Start these first. Signup and email verification is the longest external lead time in the entire plan and it blocks P4.

- [ ] Google Cloud / AI Studio — Gemma access + API key (AI Studio free tier or Vertex AI? **see Open Questions**)
- [ ] MongoDB Atlas — M0 cluster + connection string
- [ ] Sentry — org, project, DSN
- [ ] ElevenLabs — API key
- [ ] SerpApi — key (250 searches; budgeted in DATA.md)
- [ ] GitHub — create public repo `khoj`
- [ ] **Verify all six trail coordinates** (table below — these are from memory and are WRONG if unchecked)

| Trail | Lat | Lon | Elev | Status |
|---|---|---|---|---|
| Daman-e-Koh | 33.7360 | 73.0540 | ~1,300 m | ☐ unverified |
| Margalla Hills NP | 33.7400 | 73.0500 | ~1,500 m | ☐ unverified |
| Murree | 33.9058 | 73.3903 | ~2,300 m | ☐ unverified |
| Galiyat | 34.1667 | 73.3800 | ~2,600 m | ☐ unverified |
| Kaghan | 34.6069 | 73.3103 | ~1,900 m | ☐ unverified |
| Babusar | 35.6697 | 74.0897 | ~3,800 m | ☐ unverified |

Also write one or two sentences of first-hand notes per trail. These become the seed corpus for retrieval — without them, retrieval is empty on day one.

### P1 — Scaffold + scoring · T+0 → T+3 · owner: agent · **G1**

1. Move git repo root: delete `client/.git`, `git init` at `khoj/`
2. Convert to npm workspaces (root `package.json`, `shared/`, tidy `client/package.json`)
3. Delete `client/node_modules` + `client/package-lock.json`, single root `npm install`
4. Move `shadcn` CLI from `dependencies` → `devDependencies` in `client/package.json`
5. `shared/scoring-rules.ts` — the penalty tables, shared by both packages
6. `server/lib/scoring.ts` — pure functions, no I/O
7. Vitest suite: each penalty fires in isolation; boundary values; clamp behaviour

**Why first:** every later phase imports these types and constants. A slip here cascades into everything.

### P2 — Data · T+2 → T+4 · owner: agent

- `server/lib/weather.ts` — Open-Meteo fetch + normalize
- `data/trails.json` — the six-trail catalog from verified coords
- `data/conditions.json` — seed corpus
- `scripts/seed-atlas.ts` — upload + create Atlas vector index

### P3 — Retrieval · T+3 → T+6 · owner: agent · **G2**

- `server/lib/atlas.ts` — Mongo client, `$vectorSearch`, index bootstrap
- `client/embed.ts` — EmbeddingGemma in browser, WebGPU → WASM fallback
- Verify non-empty retrieval for all six trails

### P4 — Narrative + observability · T+5 → T+7 · owner: agent

- `server/lib/brief.ts` — Gemma brief, grounded, never invents numbers
- `server/lib/voice.ts` — ElevenLabs
- `server/lib/observability.ts` — Sentry init + `gen_ai.*` span helpers
- `server/lib/serp.ts` — SerpApi + Atlas cache
- `server/lib/cache.ts` — TTL wrapper

### P5 — UI · T+6 → T+9 · owner: agent

- Mobile-first PWA, shadcn components
- `client/sw.ts` — service worker, offline forecast cache
- Printable field card
- Vite dev proxy to `:3000`

### P6 — Deploy · T+9 → T+12 · owner: both · **G3**

- `Dockerfile` for the API
- `render.yaml` — Static Site + Web Service
- `.github/workflows/keep-warm.yml` — cron every 10 min
- Verify on a real phone, on mobile data

### P7 — Field trip · T+11 → T+15 · owner: user · **G4**

**Daman-e-Koh first.** Close to Islamabad, 1–2 h round trip, easy to do on a deadline. Photos, timings, honest notes on what the app got right and wrong.

Do this *before* the write-up, not during it. Deferred field trips don't happen.

### P8 — Write-up · T+13 → T+22 · owner: agent · **G5**

- `docs/POST_DRAFT.md` → final post
- Screenshots, benchmark table, Mermaid diagram
- Field report section

### P9 — Ship · T+22 → T+26 · owner: user

- Read, edit, verify claims are true
- Confirm `#devchallenge` + `#hf26challenge`
- **Name all seven partner categories explicitly** — nomination is opt-in by name
- Publish

---

## Division of labor

**User — cannot be automated:**

- All account signup and key retrieval
- Trail coordinate verification
- Trail notes for the seed corpus
- GitHub repo + Render deploy + DNS
- The actual hike
- Final review and publish

**Agent — everything else:**

- All application code, strictly TypeScript
- Fetchers, scoring layer, tests
- Atlas / Sentry / SerpApi / ElevenLabs / Gemma integration
- CI workflow, Docker, `render.yaml`
- All documentation including the post draft

---

## Risk register

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Google Cloud auth or billing delays the brief layer | Rule-based brief fallback so the app is fully functional without it |
| R2 | SerpApi returns thin results for Pakistani trails | Cache hard; degrade to weather-only; **disclose in the post** |
| R3 | Render suspends free instance for outbound traffic volume | TTL cache; steady-state outbound near zero |
| R4 | Service worker conflicts with hosting | Test in P5, not deferred to the end |
| R5 | Scope creep past six trails | Catalog is data-only. Six is the cap. |
| R6 | G3 missed — no live demo at submission | Publish anyway with a local-setup README; a repo with a working clone-and-run still scores on Technical Execution |
| R7 | Field trip weather turns | Daman-e-Koh is close and works in most October weather. Have Murree as a fallback. |
| R8 | Atlas M0 cluster throttles or sleeps | Cache reads; the vector search is one indexed query, not a scan |

---

## Cut list, in order

1. **SerpApi** — thinnest Pakistani coverage, most likely to return nothing
2. **ElevenLabs** — polish, not load-bearing
3. **Atlas `$vectorSearch`** — degrade to keyword match over the corpus
4. **Printable field card** — nice, not required

**Never cut:**

- The deployed demo
- The deterministic scorer (it *is* the product)
- EmbeddingGemma local inference (the "open at its core" claim)
- The field report

---

## Open questions

1. **Gemma access:** AI Studio free tier or Vertex AI? Changes the SDK call and caps model size (12B/27B vs 4B).
2. **Atlas vector dimension:** EmbeddingGemma emits 768 dims; confirm against the model card before creating the index — a wrong `numDimensions` fails at insert time.
3. **Is the repo name `khoj` acceptable?** There is a well-known open-source AI retrieval project named Khoj. Not a blocker for a challenge entry.