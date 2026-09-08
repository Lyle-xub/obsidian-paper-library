# Paper Library local document pipeline

Paper Library ships only a small JavaScript worker and a model manifest. The optional
runtime and FP32 weights are downloaded from the Paper Composer settings, so the base
plugin does not include PyTorch, Paddle's Python wheel, conversion scripts, or the
roughly 1 GB model pack.

The local document pipeline follows this dependency order:

1. PP-DocLayoutV2 layout analysis.
2. PP-FormulaNet-plus-M formula recognition and formula-region masking.
3. PP-OCRv6 small text detection and recognition.
4. SLANet-plus, UnetStructure, and PP-LCNet table assets.
5. Reading order and Markdown composition.

The packaged worker executes with Obsidian's Electron/Node runtime (or a system Node.js
fallback) and ONNX Runtime. Model names and FP32
weights remain aligned with the model contract; PyTorch is not installed.
Downloads support partial-file resume, expected-size checks, and SHA-256 validation
where the upstream artifact exposes a stable digest. Only the native binaries for the
current operating system and CPU architecture are downloaded.

There is deliberately no alternate text-extraction path. The built-in document renderer
only rasterizes pages before model inference. If the runtime or any required model is absent,
invalid, cancelled, or fails during inference, Paper Composer sends the complete
source PDF file to the selected Claude Code or Codex agent.

Install or remove the pack at:

`Settings → Paper Library → Paper Composer → PDF → Local parsing models`
