# Third-party licenses and provenance

Khoj's own code is MIT (see [LICENSE](LICENSE)). It depends on the following.
**Redistributing this project does not redistribute model weights** — the client
downloads them from Hugging Face at runtime — but the terms below still govern your
use.

Summaries here are for orientation, not legal advice. Check the linked sources.

---

## Models

### EmbeddingGemma 300M (ONNX)

- **Used by:** the browser, via Transformers.js
- **Source:** `onnx-community/embeddinggemma-300m-ONNX`
- **Base model:** `google/embeddinggemma-300m`
- **License:** Gemma terms of use
- **Purpose:** generates the 768-dimension condition vectors used for retrieval

**Attribution required.** Gemma terms require acknowledging Google's Gemma models.
Satisfy this in the README, the app UI, and the DEV post.

**Non-commercial use.** Gemma's terms restrict commercial use without a separate
agreement. Khoj is a non-commercial challenge project. If you reuse this commercially,
read the terms first — this is the single most likely licensing mistake in the project.

**Not redistributed.** Weights are fetched from the Hugging Face CDN on first use. We
commit no weights to the repository.

### Gemma 3

- **Used by:** the briefing layer, via Google Cloud
- **License:** Gemma terms of use
- **Access:** hosted inference — weights are not distributed by this project

Same attribution and non-commercial terms apply. Hosted access does not create an
exception to them.

---

## Data

### Open-Meteo

- **Used by:** all forecast data
- **Endpoints:** Forecast API, Historical Weather API (ERA5)
- **License:** CC BY 4.0
- **API key:** not required for non-commercial use
- **Attribution:** required — satisfied in the README and app footer

> **Open-Meteo requires attribution.** This is the one data licence here that obligates
> us rather than merely permitting. Keep the credit visible in the app, not just the
> README.

Underlying reanalysis data: ERA5 / ERA5-Land (Copernicus Climate Change Service),
ECMWF IFS. Those carry their own terms for redistribution of the raw archives; we
request derived values over HTTP and redistribute nothing.

### MongoDB Atlas

- **Used by:** trail catalog, TTL cache, vector index
- **Tier:** M0 free
- **License:** MongoDB Atlas ToS. Data is ours.

### SerpApi

- **Used by:** live trail reports
- **Tier:** 250-search free tier
- **License:** SerpApi ToS. Search results are subject to the underlying publishers'
  terms and are cached for personal use only.

---

## Runtime dependencies

Full transitive licence inventory — including every transitive package — is
regenerable at any time:

```bash
npx license-checker --summary
npx license-checker --production --json > third-party-licenses.json
```

### Client

| Package | License |
|---|---|
| React, React DOM | MIT |
| Vite | MIT |
| TypeScript | Apache-2.0 |
| Tailwind CSS | MIT |
| shadcn/ui components | MIT |
| Base UI (`@base-ui/react`) | MIT |
| `@huggingface/transformers` | Apache-2.0 |
| onnxruntime-web | MIT |
| @tabler/icons-react | MIT |

### Server

| Package | License |
|---|---|
| Hono | MIT |
| `@hono/node-server` | MIT |
| MongoDB Node driver | Apache-2.0 |
| `mongodb` | SSPL **and** Apache-2.0 (dual) — Apache-2.0 applies |
| @sentry/node | MIT |
| @sentry/react | MIT |
| @google/genai | Apache-2.0 |
| @elevenlabs/elevenlabs-js | MIT |
| zod | MIT |

**No copyleft anywhere in the dependency tree.** No GPL, AGPL, or SSPL-only dependency.
This is what makes MIT licensing of the project safe.

---

## Infrastructure

| Service | Terms |
|---|---|
| Render | Render ToS. Free tier includes a public subdomain. |
| GitHub Actions | GitHub ToS. Free for public repositories. |

---

## Compliance summary

| Obligation | Status |
|---|---|
| Attribution — EmbeddingGemma / Gemma | Required in README + UI + post |
| Attribution — Open-Meteo (CC BY) | Required, and is the strictest obligation here |
| Non-commercial restriction — Gemma family | Khoj is non-commercial. Reuse commercially requires reading the terms |
| No weights redistributed | Confirmed — fetched at runtime, none committed |
| No copyleft in dependencies | Confirmed |
| Search results cached | Personal use only; 250-search budget respected |

---

## Reproducing this inventory

```bash
npm install
npx license-checker --summary
```

> Regenerate before publishing. Dependency licences change between versions, and a
> stale inventory is worse than none — it asserts something that may no longer be true.