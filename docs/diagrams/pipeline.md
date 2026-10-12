flowchart LR
    A["Forecast text<br/>'muddy after rain,<br/>stream high, 14°C'"] --> B["EmbeddingGemma<br/>browser, ONNX"]
    B --> C["768-float vector"]
    C -->|"vector only"| D["Atlas<br/>$vectorSearch"]
    D --> E["k similar<br/>conditions"]
    E --> F["Gemini 2.5 Flash<br/>brief (given score)"]
    G["Open-Meteo"] --> H["Deterministic<br/>score"]
    H --> F
    F --> I["ElevenLabs<br/>spoken brief"]
```