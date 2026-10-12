flowchart TB
    subgraph Browser["Browser"]
        UI["React PWA"]
        EMB["EmbeddingGemma-300M<br/>Transformers.js / ONNX<br/>WebGPU → WASM"]
        SW["Service worker<br/>offline cache"]
    end

    subgraph CDN["Render Static Site"]
        SHELL["PWA shell<br/>never sleeps"]
    end

    subgraph API["Render Web Service (Docker)"]
        HONO["Hono"]
        SCORE["scoreDay()<br/>pure, no I/O"]
        RET["retrieveSimilar()"]
        BRIEF["brief<br/>rule fallback"]
        OBS["observability<br/>gen_ai.* spans"]
    end

    subgraph Ext["Upstreams"]
        OM["Open-Meteo"]
        ATLAS[("Atlas<br/>$vectorSearch")]
        GEM["Gemini / Gemma"]
        SERP["SerpApi"]
        EL["ElevenLabs"]
    end

    UI --> EMB
    EMB -->|"768 floats only"| HONO
    UI -.-> SW
    SHELL -.-> UI

    HONO --> SCORE
    HONO --> RET
    HONO --> BRIEF
    HONO --> OBS
    SCORE --> OM
    RET --> ATLAS
    BRIEF --> GEM
    BRIEF --> SERP
    BRIEF --> EL
    OBS -.-> OBS