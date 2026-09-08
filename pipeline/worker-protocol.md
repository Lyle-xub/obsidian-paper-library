# Local worker protocol

Paper Library invokes the bundled `pipeline/worker.cjs` with the user's Node.js
executable. ONNX Runtime and the lightweight JavaScript orchestration package are
downloaded into `pipeline-runtime/node_modules` for the current platform only.

The invocation is:

```text
node pipeline/worker.cjs \
  --input <absolute-pages-json-path> \
  --models <absolute-model-root> \
  --output <absolute-cache-directory> \
  --runtime <absolute-runtime-directory> \
  --contract <absolute-models.json>
```

The worker must write `<output>/document.json` atomically. The minimum schema is:

```json
{
  "engine": "mineru-compatible-no-torch-v2",
  "totalPages": 1,
  "pages": [
    {
      "page": 1,
      "markdown": "Page Markdown with $formula$ and table HTML",
      "blocks": []
    }
  ],
  "assetsPath": "/absolute/cache/assets"
}
```

`pages.json` references raw RGBA page buffers produced by the plugin. The worker executes layout, formula recognition,
OCR, table recognition, reading order, and Markdown composition, then atomically
writes `document.json`.

A missing artifact, invalid runtime, malformed output, timeout, or non-zero exit code
is a hard local-pipeline failure. Paper Library then sends the complete original PDF
to the Composer agent; it never substitutes another local extraction path.
