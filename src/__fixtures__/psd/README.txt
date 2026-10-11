Independent PSD fixtures generated for KerfDesk, 2026-10-11.
All artwork is drawn in generate-reference-fixtures.py. No external artwork or
upstream test corpus is included. ag-psd is not used to encode these fixtures.

Reproduce in an isolated Python environment:
  pip install psd-tools==1.24.0 Pillow==12.3.0 numpy==2.4.6
  python generate-reference-fixtures.py

The generator writes the four PSDs and a fixtures.json manifest alongside itself.
The decoder tests compare full RGBA SHA-256 values against the original Pillow
pixels and verify resolution metadata, including separate horizontal/vertical DPI.
two-layers.psd stores independently supplied merged pixels plus two pixel layers;
the import contract uses only its stored composite, never recomposites layers.

Additional handcrafted corruption, transparency, PPCM and unsupported-mode cases
are built in ../psd-document.ts, independently of the decoder and ag-psd writer.
