# API

Base URL: `https://<service>.onrender.com`

All responses are `application/json`. Errors follow a consistent envelope.

---

## `GET /api/health`

Liveness probe for Render's health check and the keep-alive cron.

**Response `200`**

```json
{ "ok": true, "uptime_s": 48213 }
```

> The keep-alive cron must target this path. Render intercepts `/robots.txt` while an instance is spun down, and that request **does not** wake it.

---

## `GET /api/trails`

The trail catalog. No query parameters.

**Response `200`**

```json
{ "trails": [ /* the six trails from data/trails.json */ ] }
```

Adding a trail is a data-only change (FR8) — this endpoint reflects
`data/trails.json` and nothing else.

---

## `GET /api/advice`

The main endpoint. Scores a trail over a date range.

### Query parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `trail` | string | **required** | Trail `id` from the catalog |
| `days` | integer | 7 | 1–16, capped by Open-Meteo forecast horizon |
| `embedding` | string | — | Base64-encoded Float32Array, 768 dims. Optional — omit to skip retrieval |

### Request

```http
GET /api/advice?trail=galiyat&days=7&embedding=AAAA...
```

### Response `200`

```jsonc
{
  "trail": {
    "id": "galiyat",
    "name": "Galiyat",
    "elevation_m": 2600,
    "difficulty": "moderate"
  },
  "days": [
    {
      "date": "2026-10-17",
      "score": 74,
      "band": "GO",
      "penalties": [
        {
          "key": "mudPenalty",
          "label": "Wet ground from recent rain",
          "points": 18,
          "detail": "34 mm of rain in the prior 3 days"
        }
      ],
      "bonus": [
        { "key": "daylightBonus", "label": "Long daylight", "points": 6 }
      ],
      "weather": {
        "tmax_c": 21.4,
        "precip_mm": 0.0,
        "snow_cm": 0,
        "wind_max_kmh": 14,
        "weather_code": 2
      }
    }
  ],
  "similar_conditions": [
    {
      "date": "2026-10-14",
      "field_note": "Lower trail impassable past the waterfall. Ridge fine but very windy at the top.",
      "similarity": 0.83,
      "outcome": "partial"
    }
  ],
  "brief": {
    "text": "Galiyat looks good Saturday — 22°C and dry, with a stiff ridge wind. Go early; the lower trail was a mudbath last week.",
    "source": "gemma",
    "audio_url": "https://api.elevenlabs.io/v1/text-to-speech/xyz.mp3"
  },
  "live_reports": [
    {
      "title": "Galiyat road conditions update",
      "snippet": "…",
      "url": "https://…",
      "source": "serpapi"
    }
  ],
  "meta": {
    "cached": false,
    "generated_at": "2026-10-16T18:04:11.000Z",
    "model": "gemma-3-…",
    "degraded": false
  }
}
```

### Field notes

| Field | Meaning |
|---|---|
| `score` | 0–100, integer |
| `band` | `"GO"` (≥70), `"MAYBE"` (45–69), `"NO"` (<45) |
| `penalties[]` | **Always present.** Every point deducted, named and quantified |
| `bonus[]` | Points added. Separate from penalties so the maths is legible |
| `similar_conditions[]` | Empty array if `embedding` omitted or retrieval unavailable |
| `brief.source` | `"gemma"` or `"rule"` — the UI **must** label a rule-based brief |
| `meta.degraded` | `true` if any upstream was unavailable |
| `meta.cached` | `false` on a fresh compute |

`penalties[]` being always present is the point of the API. A bare score with no decomposition would break FR2 and the reason the tool is worth trusting.

---

## Errors

```json
{
  "error": true,
  "code": "UNKNOWN_TRAIL",
  "message": "No trail with id 'nandana'",
  "trace_id": "abc123"
}
```

| Status | `code` | When |
|---|---|---|
| 400 | `UNKNOWN_TRAIL` | `trail` is not in the catalog |
| 400 | `INVALID_DAYS` | `days` outside 1–16 |
| 400 | `INVALID_EMBEDDING` | Wrong length or not decodable |
| 400 | `INVALID_QUERY` | Any other malformed query |
| 429 | `RATE_LIMITED` | Too many uncached requests |
| 503 | `WEATHER_UNAVAILABLE` | Open-Meteo failed — no score without weather |
| 503 | `OFFLINE` | Emitted by the service worker when offline and nothing is cached |
| 500 | `INTERNAL` | Anything else |

All four error shapes have been exercised against the running server.

**`WEATHER_UNAVAILABLE` is the only hard failure.** Everything else degrades: no key → feature omitted, upstream error → rule-based fallback. A trail app that shows a spinner because a narration service is down has failed at its one job.

---

## Verified behaviour

Run against the live server, not asserted:

| Case | Request | Result |
|---|---|---|
| Happy path | `?trail=daman-e-koh&days=7` | `200`, 7 scored days, penalties populated |
| Elevation scaling | `?trail=babusar&days=16` | `NO` (41) on 2026-10-14, `snowPenalty=35` |
| Cache miss then hit | same URL twice | `X-Cache: MISS` then `HIT` |
| Unknown trail | `?trail=nandana` | `400 UNKNOWN_TRAIL` |
| Bad window | `?trail=murree&days=99` | `400 INVALID_DAYS` |
| Bad vector | `?trail=murree&embedding=AAAA` | `400 INVALID_EMBEDDING` |
| Valid 768-vector | base64 Float32Array | accepted, used for `$vectorSearch` |

---

## Rate limits

| Tier | Limit |
|---|---|
| Uncached requests | 30 / minute per IP |
| Cached responses | Not limited (served from Atlas) |

Responses carry `X-Cache: HIT | MISS` so the client can show freshness without a second request.

---

## CORS

Open in development so the Vite proxy and the API can run on separate ports. In production the Static Site and Web Service are on different `onrender.com` origins, so CORS **must** be configured for the static site origin.

```ts
app.use('/api/*', cors({
  origin: ['http://localhost:5173', process.env.PUBLIC_SITE_ORIGIN!],
}))
```

---

## Design notes

**Why GET and not POST?** The response is cacheable by CDN and browser, and the URL is shareable — a friend can open the exact same advice link. With a request body, neither works.

**Why is `embedding` a query param and not a header?** Convenience for debugging and for the service worker. It is a large base64 string, which is unusual for a URL, but the request is cacheable and shareable as a result — which matters more for this app than URL tidiness.

**Why embed retrieval results instead of raw text?** The server cannot reconstruct conditions from a vector. That is the privacy property, and it is why the API shape is what it is.