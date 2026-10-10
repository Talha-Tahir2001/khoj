# Judging map

Challenge criteria → the specific artifact that satisfies them. Verify coverage
**before** submitting, not after.

**Deadline:** 2026-10-11 23:59 PDT

---

## Primary criteria

These decide the overall prize and are weighted as the challenge states:
Writing Quality most heavily, then Relevance to Prompt and Theme.

### 1. Writing Quality — *weighted most heavily*

| Requirement | Evidence | Status |
|---|---|---|
| Clear and engaging | Post leads with the trip, not the stack | ☐ draft exists |
| Explains what was built | Post §"What it actually does" | ☐ |
| Explains who it's for | Post §"The six-hour drive" | ☐ |
| Explains why open innovation matters | Post §"Why open won here" — 2–3 concrete claims, not a list | ☐ |
| Demo shown | Screenshots + live URL | ☐ |

> **Highest-leverage section in the whole post.** Budget real time. The strong entries
> in this challenge read like essays with a project in them, not READMEs with an essay
> bolted on.

### 2. Relevance to the Prompt and Theme

| Requirement | Evidence | Status |
|---|---|---|
| Open-source AI at the core | EmbeddingGemma (open-weight, ONNX) runs client-side and produces the retrieval set. Not decorative — the app is worse without it. | ☐ verified working |
| Fits "Touch Grass" | Gets people outside; screen time is minimized; offline mode supports trail use | ☐ |
| Novel | No existing entry targets Pakistan. ~10 existing entries are North America / Western Europe birding; ~6 are US garden planners. | ☐ |

### 3. Creativity

| Element | Evidence | Status |
|---|---|---|
| Original framing | "Which Saturday is worth the drive" — a decision tool, not a weather app | ☐ |
| Geographic whitespace | No other entry covers this region | ☐ |
| Honest novelty claim | Post does **not** claim the scoring method is novel | ☐ |

### 4. Technical Execution

| Requirement | Evidence | Status |
|---|---|---|
| It works | Live URL; tested on a phone over mobile data | ☐ **G3** |
| Well built | Vitest suite; pure scoring layer; typed end to end | ☐ **G1** |
| Degrades honestly | Every upstream has a defined fallback; response carries `source` and `meta.degraded` | ☐ |
| Documented | README + 7 docs + `THIRD_PARTY.md` | ☐ |
| Real deployment | Two Render services from `render.yaml` | ☐ |

### 5. Use of Partner Technology — *optional, per-category*

See the table below. **Each category is opt-in by name.**

---

## Partner categories

**$1,150 total. Unnamed categories are forfeited.**

| Category | Prize | Evidence required | Status |
|---|---|---|---|
| **Gemma** | $200 | EmbeddingGemma locally via Transformers.js **and** Gemma 3 for briefs — two distinct uses, not one token gesture | ☐ |
| **Render** | $200 | Static Site + Web Service, deployed from `render.yaml`, keep-alive cron present in repo | ☐ |
| **MongoDB Atlas** | $100 | `$vectorSearch` as the retrieval layer — not "we store JSON in Mongo" | ☐ |
| **Sentry** | $100 | `gen_ai.invoke_agent` parent + `gen_ai.chat`/`execute_tool` children; **latency and token numbers in the post** | ☐ |
| **SerpApi** | $100 | Live trail reports, meaningful use, cached against the 250-search cap | ☐ |
| **ElevenLabs** | $100 | Spoken brief — justified by "listen in the car, don't look at your phone" | ☐ |
| **Entire** | $100 | Agent session embedded or linked in the post | ☐ |
| **Overall** | $250 | Everything above, plus the field report | ☐ |

### Category risks

| Category | Risk | Mitigation |
|---|---|---|
| SerpApi | Pakistani trail coverage may be thin or empty | Cache hard. If it returns nothing, **say so** — a disclosed thin result beats a fabricated one |
| ElevenLabs | "Nice to have" is not a category | Tie it to a specific moment: hands-free in the car |
| Sentry | Auto-instrumentation doesn't fire on Hono | Manual `gen_ai.*` spans using documented templates |
| MongoDB | Weak if retrieval isn't wired end to end | Vector search must return real results, not an empty array |

---

## Gates

| Gate | Condition | Deadline | Status |
|---|---|---|---|
| G1 | Scoring tests green | T+3h | ☐ |
| G2 | Retrieval non-empty, all six trails | T+6h | ☐ |
| G3 | Live URL responding | T+12h | ☐ |
| G4 | Field trip done, photos + notes | T+15h | ☐ |
| G5 | Post draft complete | T+20h | ☐ |

**G3 and G4 are the deciding pair.** Everything else is negotiable; a dead demo link and a missing field report are what turn a completion badge into nothing.

---

## Submission checklist

### Content
- [ ] Post uses the official submission template
- [ ] Title, intro, "How I Built It", "Why Does Open Innovation Matter?" all present
- [ ] Field report written from a real trip
- [ ] Every claim verifiable against the running app

### Tags
- [ ] `#devchallenge`
- [ ] `#hf26challenge`
- [ ] AI disclosure set correctly

### Categories
- [ ] All seven partner categories named **in the post body**
- [ ] Overall not nominated separately — it's awarded on merit

### Assets
- [ ] Live demo URL loads and works
- [ ] Public GitHub repo
- [ ] Screenshots on a phone
- [ ] Mermaid diagram renders (DEV supports it natively)
- [ ] Agent session embedded or linked
- [ ] Sentry table with real numbers

### Honesty pass
- [ ] Limitations section still accurate
- [ ] Nothing claimed that was not actually done
- [ ] Anything aspirational deleted

> The final read is for this last section only. Overclaiming is the fastest way to lose
> Technical Execution, and the challenge explicitly rewards honest limitations.
> Several existing entries scored well *because* they documented what didn't work.

---

## What most likely loses points

1. **Publishing without the field trip.** "Bonus points if you take it outside, use it,
   and tell us how it went." Entries that admitted they hadn't been outside lost ground
   to entries that had, even when the technical work was comparable.
2. **Only one partner category.** Each is a separate winner slot. A second integration
   is worth more than a second day on the first.
3. **Under-describing the open-source angle.** The challenge asks specifically where
   open beat closed. Two concrete, verified claims beat six generic ones.
4. **Aspirational numbers.** Latency and accuracy figures that don't match reality are
   caught, and they cost the whole submission's credibility.