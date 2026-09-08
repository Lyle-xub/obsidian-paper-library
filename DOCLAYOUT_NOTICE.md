# DocLayout-YOLO runtime notice

The optional local figure-extraction sidecar uses the DocLayout-YOLO DocStructBench model with ONNX Runtime, Pillow and PyMuPDF. It does not install PyTorch. The upstream model and implementation are distributed under the upstream AGPL-3.0 terms. The sidecar runs as a separate local Python process and does not transmit PDFs or extracted figures to a remote service.

- Source: https://github.com/opendatalab/DocLayout-YOLO
- Upstream model: https://huggingface.co/juliozhao/DocLayout-YOLO-DocStructBench
- ONNX export: https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx
- License: https://github.com/opendatalab/DocLayout-YOLO/blob/main/LICENSE
