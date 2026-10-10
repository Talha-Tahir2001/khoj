# Khoj — Product Requirements

**Status:** v1, pre-implementation
**Owner:** 2-person team (one human, one agent)

---

## 1. Problem

Deciding *"should I go hiking this weekend?"* in northern Pakistan is guesswork.

Conditions swing hard between October and December. Post-monsoon mud makes lower trails slow and slippery. Ridge wind picks up without warning. Above 3,000 m, first snow can close Babusar outright — and a drive there is six hours each way, so discovering that at the trailhead is a wasted day.

Anyone with a free Saturday and a car faces the same question. Nobody has a tool that answers it for the *specific trail* they mean. Generic weather apps give a city-level forecast for Islamabad, which is meaningless for a ridge 2,000 m above it. Gardening and birding apps solve different problems in different countries.

## 2. Users

**Primary — weekend hikers.** Islamabad, Rawalpindi, Abbottabad. Know the trails by name; do not know the weather. Mobile-first, checking on a phone, often deciding Friday night.

**Secondary — hiking groups.** Planning a shared trip and needing one shared answer instead of six opinions.

## 3. Job to be done

> When I have a free Saturday, tell me which of these trails is worth driving to — and give me a reason I trust.

The emphasis is on **reason I trust**. A bare score with no explanation is worse than useless, because the user has no way to sanity-check it and will fall back to the thing they already do (staying in).

## 4. Core loop

1. Pick a trail and a date range
2. Get a scored verdict per day — **GO / MAYBE / NO** — with named contributing reasons
3. Get a real-world comparison: past days with similar conditions on that trail
4. Get a 3-sentence spoken brief
5. **Close the browser. Go outside.**

Success is step 5 happening faster than any alternative. Every design decision below exists to shorten the time between opening the app and closing it.

## 5. Scope

### In

- Six trails: Daman-e-Koh, Margalla Hills NP, Murree, Galiyat, Kaghan, Babusar
- 16-day forecast scoring from Open-Meteo
- Semantic retrieval over a seeded observation corpus
- Spoken brief via ElevenLabs
- Offline cache of the last-fetched forecast

### Out — explicitly

- Live GPS tracking
- Social features, comments, leaderboards, sharing
- User accounts and authentication
- Anything that increases screen time

**No accounts is a feature.** There is no personal data to protect, and it removes an entire class of work from a 30-hour build.

## 6. Functional requirements

| ID | Requirement |
|---|---|
| FR1 | Score any trail-day from Open-Meteo with no API key and no account |
| FR2 | Every score decomposes into **named contributing penalties** — never a bare number |
| FR3 | Retrieve the *k* semantically similar historical conditions for a given forecast |
| FR4 | Generate a brief grounded in score + retrieval. The model is **given** the score; it never computes or invents one |
| FR5 | Narrate the brief to audio |
| FR6 | Serve the last-known forecast with the network disabled, clearly marked as cached |
| FR7 | Trace every AI call with Sentry `gen_ai.*` spans, including a parent `gen_ai.invoke_agent` |
| FR8 | Adding a trail is a **data-only** change — no code edits |

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NF1 | The client sends a 768-float vector to the API. Raw condition text never leaves the browser |
| NF2 | Fully usable on a mid-range Android over 4G |
| NF3 | API p95 < 2 s, excluding upstream model latency |
| NF4 | No PII is collected, because there are no accounts |
| NF5 | The scoring layer is pure and unit-tested — no I/O, no clock, no network |

## 8. Scoring model — deliberate design choice

The comfort score is **deterministic arithmetic, not a learned model.**

```
score = 100
  − precipPenalty   (precipitation_sum, steep curve above 2 mm)   max 35
  − mudPenalty      (precipitation over the prior 3 days)        max 30
  − windPenalty     (wind_speed_10m_max, ramp above 20 km/h)     max 20
  − heatPenalty     (temperature_2m_max above 32 °C)             max 20
  − visPenalty      (weather_code ∈ {45, 48} — fog)              max 15
  − snowPenalty     (snowfall_sum × elevation)                   max 35
  + daylightBonus   (withheld once penalties exceed 40)          max 10
  clamped to [0, 100]

GO ≥ 70    MAYBE 45–69    NO < 45
```

Every term maps to a real October hazard in northern Pakistan: post-monsoon mud, ridge wind, heat, valley fog, first snow on Babusar.

**The viability ceiling.** When total penalties exceed 40 points, the daylight bonus is withheld. Without this rule a long sunny day can lift a mud-soaked trail out of NO and into MAYBE. A long day does not help when the ground is a mudslide, and a score implying otherwise is worse than no score.

**Why rules and not a model:** a number a user is asked to skip a six-hour drive for must be auditable. Each penalty is unit-testable in isolation, so correctness is *demonstrated*, not asserted. A model would be less predictable and impossible to explain — "the model said 62" is not a reason anyone trusts.

**Where the model does work:** semantic retrieval over real past conditions. That is genuinely not expressible as a rule — matching "muddy after rain, stream crossing high" to a stored observation requires learned semantics. That is EmbeddingGemma's job, and it is where the open-weight model earns its place.

## 9. Honesty requirements

The following are **stated in the README and in the DEV post**, not buried:

| ID | Limitation |
|---|---|
| L1 | The score is deterministic rules. The model does retrieval and narration only. |
| L2 | The corpus is small and hand-seeded; retrieval quality is bounded by its size. |
| L3 | Coronal weather is predicted from reanalysis; mountainous terrain is the hardest case for it. |
| L4 | SerpApi coverage of Pakistani trail conditions is thin. |
| L5 | Open-Meteo forecast skill degrades beyond ~10 days. |

Overclaiming here is the single easiest way to lose a technical-execution score. Stating it plainly costs nothing and reads as confidence.

## 10. Success criteria

- [ ] Live URL reachable (G3)
- [ ] All six trails scoring with visible, decomposable reasons
- [ ] Non-empty retrieval for all six trails (G2)
- [ ] Unit tests green, each penalty proven in isolation (G1)
- [ ] Field trip completed and written up honestly (G4)
- [ ] Seven partner categories named explicitly in the post
- [ ] Post published with `#devchallenge` and `#hf26challenge`

## 11. Prize targets

| Category | Tier | How |
|---|---|---|
| **Overall** | $250 | Field report + honest write-up |
| **Gemma** | $200 | EmbeddingGemma locally **and** Gemma 3 for the brief — two distinct uses |
| **Render** | $200 | Static Site + Web Service + keep-warm cron |
| **Sentry** | $100 | `gen_ai.*` spans + latency/token table in the write-up |
| **MongoDB Atlas** | $100 | `$vectorSearch` as the retrieval layer |
| **SerpApi** | $100 | Live trail reports, cached |
| **ElevenLabs** | $100 | Spoken brief |
| **Entire** | $100 | Agent session embedded in the post |

**Eligibility rule:** each partner category is opt-in **by name**. Not naming a category forfeits it. Worth $1,150 if every slot lands.