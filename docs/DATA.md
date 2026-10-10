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

It is **hand-seeded and small** — six trails, a handful of observations each. Retrieval *works*, but its quality is bounded by that size. With one record per trail, every query returns that record and the feature is decorative.

**This is why your own notes matter.** First-hand observations of these trails — from the trips you have already taken — are worth more than anything generated. They are also more honest.

### Why text embeddings for weather

Embeddings let "muddy after rain, stream crossing high" retrieve a record written as "the lower path was a mess after Wednesday's rain, had to wade the stream." Lexical matching fails on that. A lookup table cannot do it at all. This is the specific reason an open-weight model earns its place in the app.

### Atlas index

```js
db.observations.createIndex({
  embedding: "vector",
  indexType: "vectorSearch",
  definition: "vectorSearch",
  "vectorSearch": {
    "numDimensions": 768,        // ← EmbeddingGemma output. Verify before creating.
    "path": "embedding",
    "similarity": "cosine",
    "numCandidates": 100
  }
})
```

A wrong `numDimensions` fails at insert time, not query time. Confirm against the model card first.

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