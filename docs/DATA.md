# Data

## Sources

| Source | What | Key required? | Terms |
|---|---|---|---|
| [Open-Meteo](https://open-meteo.com/) | Forecast + historical weather | **No** | CC BY 4.0, attribution required |
| MongoDB Atlas | Trail catalog, cache, vector index | Yes (M0 free) | Atlas ToS |
| SerpApi | Live trail reports | Yes | 250 searches on the free tier |

**Open-Meteo requiring no key is load-bearing.** It means the data layer cannot rate-limit, expire, or be revoked mid-build. On a 30-hour deadline that matters more than usual.

---

## Open-Meteo

### Forecast endpoint

```
GET https://api.open-meteo.com/v1/forecast
  ?latitude=34.1667
  &longitude=73.3800
  &daily=temperature_2m_max,precipitation_sum,snowfall_sum,
         wind_speed_10m_max,weather_code,daylight_duration
  &forecast_days=16
  &timezone=auto
```

### Fields used

| Field | Unit | Used by |
|---|---|---|
| `temperature_2m_max` | °C | `heatPenalty` (above 32 °C) |
| `precipitation_sum` | mm | `precipPenalty` (steep above 2 mm) |
| `snowfall_sum` | cm | `snowPenalty` (weighted by elevation) |
| `wind_speed_10m_max` | km/h | `windPenalty` (ramp above 20 km/h) |
| `weather_code` | WMO | `visPenalty` (45, 48 = fog) |
| `daylight_duration` | s | `daylightBonus` vs. seasonal norm |

### Why daily, not hourly

A hike decision is a day decision. Hourly data would triple the payload and the scoring complexity for no decision value. The one case hourly would help — a specific departure time — is out of scope.

### Weather codes

Only two are scored, because only two meaningfully affect whether to hike:

| Code | Meaning | Effect |
|---|---|---|
| 45 | Fog | `visPenalty` |
| 48 | Depositing rime fog | `visPenalty` |

Everything else is ignored. Codes 95–99 (thunderstorms) are worth noting as a **known gap** — Open-Meteo's own docs say thunderstorms cannot be reliably derived from atmospheric stability data. Summer thunderstorms would matter; in October they are not the deciding factor. Recorded rather than silently ignored.

---

## Trail catalog

`data/trails.json`. Coordinates are **unverified** — see the checklist in [PLAN.md](../PLAN.md).

```jsonc
{
  "id": "galiyat",
  "name": "Galiyat",
  "lat": 34.1667,
  "lon": 73.3800,
  "elevation_m": 2600,
  "difficulty": "moderate",
  "typical_hours": 5,
  "notes": "Autumn colour in mid-October. Ridge section is exposed to wind."
}
```

| Trail | Lat | Lon | Elev | Status |
|---|---|---|---|---|
| Daman-e-Koh | 33.7360 | 73.0540 | ~1,300 m | ☐ unverified |
| Margalla Hills NP | 33.7400 | 73.0500 | ~1,500 m | ☐ unverified |
| Murree | 33.9058 | 73.3903 | ~2,300 m | ☐ unverified |
| Galiyat | 34.1667 | 73.3800 | ~2,600 m | ☐ unverified |
| Kaghan | 34.6069 | 73.3103 | ~1,900 m | ☐ unverified |
| Babusar | 35.6697 | 74.0897 | ~3,800 m | ☐ unverified |

Adding a trail is a **data-only change** — no code edits (FR8).

### Elevation drives the snow penalty

`snowPenalty` scales with elevation because the same centimetre of snow means something different at 1,300 m than at 3,800 m. Babusar gets early snow in October; Daman-e-Koh essentially never does. Without this term the same forecast would score a walk in the Margallas and a drive to Babusar as equally good, which would be badly wrong.

---

## Observation corpus

`data/conditions.json`, seeded into Atlas. This is what retrieval searches.

```jsonc
{
  "_id": "galiyat-2026-10-14",
  "trail": "galiyat",
  "date": "2026-10-14",
  "conditions_text": "Muddy after rain, stream crossing high, overcast, cold morning",
  "embedding": [/* 768 floats, added by the seeder */],
  "field_note": "Lower trail impassable past the waterfall. Ridge was fine but very windy at the top.",
  "outcome": "partial"
}
```

### The corpus is the weakest part

**24 hand-seeded records, four per trail.** Retrieval *works* — `npm run
verify:trails` confirms every trail returns its own observation first when used
as its own query — but quality is bounded by that size. With one record per
trail, every query returns that record and the feature is decorative.

**This is why your own notes matter.** First-hand observations of these trails —
from trips you have already taken — are worth more than anything generated. They
are also more honest. Add them to `data/conditions.json` and re-run
`npm run seed:atlas`.

### Why text embeddings for weather

Embeddings let "muddy after rain, stream crossing high" retrieve a record
written as "the lower path was a mess after Wednesday's rain, had to wade the
stream." Lexical matching fails on that. A lookup table cannot do it at all.
This is the specific reason an open-weight model earns its place in the app.

### Semantic vs keyword retrieval, measured

The open-model story rests on this claim, so it was measured rather than
asserted (`npm run verify:retrieval`, real EmbeddingGemma, real corpus):

| Query | Embedding top hits | Keyword fallback |
|---|---|---|
| "Muddy after rain, stream crossing high" | Galiyat **0.94**, Margallas **0.81**, Kaghan **0.80** — all genuinely muddy | Murree rain notes at **0.43** — wrong trails entirely |

The keyword path matched literal tokens and returned records from trails that
were wet but not muddy-after-rain. The embedding found the right ones. That gap
is the reason the model is in the product rather than bolted onto it.

### Atlas index

```js
db.observations.createIndex(
  { embedding: "vector" },
  {
    name: "vector_index",
    type: "vectorSearch",
    definition: "vectorSearch",
    vectorSearch: {
      numDimensions: 768,        // ← VERIFIED, see below
      path: "embedding",
      similarity: "cosine",
      numCandidates: 100
    }
  }
)
```

> **`numDimensions` was verified empirically, not read off a model card.**
> EmbeddingGemma-300M was loaded through Transformers.js and run; the pooled,
> normalised output is exactly **768** dimensions. This matters because a wrong
> `numDimensions` fails at INSERT time, not query time. `npm run seed:atlas`
> asserts the length before writing anything, and refuses to create the index on
> a mismatch.

The base64 transport was verified the same way: 768 floats encode to a
4,096-character string and decode back bit-identical.

### The mud penalty has a blind spot

`priorRainfall` sums rain from within the forecast window only. Open-Meteo
returns a forward-looking window, so **day 0 always has zero prior rainfall**
even if it rained for a week beforehand. This is a real limitation, not a bug
that could be coded away — it needs a separate historical-API call, which would
cost a network round trip per trail on a budget that prefers none. Retrieval
partially recovers the qualitative picture; the number does not.

---

## Caching

| Data | TTL | Why |
|---|---|---|
| Advice response | 1 h | Matches Open-Meteo update cadence |
| Raw forecast | 1 h | Same |
| SerpApi results | 12 h | 250 searches total — re-fetching is not affordable |
| Briefs | 24 h | Briefs do not need to be fresh |
| Embeddings | permanent | Content-addressed; conditions text never changes |

**This is a Render constraint, not just performance.** Free instances may be suspended for "initiating an uncomably high volume of traffic over the public internet — invoking external APIs." Four upstream calls per request is exactly that pattern. Steady-state outbound must stay near zero.

## SerpApi budget

250 searches, hard cap. Allocation:

| Purpose | Searches |
|---|---|
| Trail-condition queries, 6 trails, cached 12 h | ~180 |
| Verification during the field trip | ~50 |
| Reserve | ~20 |

Queries are per-trail and cached aggressively. Never per-request.