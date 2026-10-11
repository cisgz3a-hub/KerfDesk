## ADR-591: Offline text shaping, Photoshop composite import and advanced nesting

**Status:** Accepted implementation decision | **Date:** 2026-10-11

## Context

The maintainer requested implementation after comparing external repositories
against KerfDesk. Benchmarks found incorrect combining-mark/RTL layout, no PSD
import, and avoidable extra sheets for concave nesting examples. Maker.js did not
provide a missing primitive and is not adopted. Research is evidence for bounded
features, not a claim that all documents or layouts will improve.

## Decision

- Pin `harfbuzzjs@1.6.3` and `bidi-js@1.1.0`. Load HarfBuzz in the I/O layer for
  text requiring shaping/bidi; pass the prepared runtime into pure core geometry.
  Keep ordinary Latin and single-line stroke-font behavior compatible. Keep exact
  outline curves, units, wrapping, tracking, and path placement in KerfDesk.
  Unicode 17 script data supports script itemisation; unsupported font glyphs
  remain visible warnings rather than a guessed font substitution.
- Pin `ag-psd@31.0.3` for a saved merged Photoshop composite. Support `.psd`,
  8-bit RGB/grayscale, raw/RLE, correct alpha and physical density. Preflight
  byte ranges, dimensions and resource limits before decoding in the existing
  cancellable import worker. The embedded decoder/PNG encoder reserves 64 bytes
  per source pixel plus two file copies against a 512 MiB working-allocation
  budget before reading the whole file; over-budget PSDs require resizing or a
  PNG export. This resource budget is separate from the canvas edge limit.
  Reuse bitmap engraving/trace flows. Editable layers,
  PSB, unsupported compression and higher bit depths are outside this slice.
- Package the official PackingSolver WASM artifact at source
  `49bf6c7d9d2204f17d698ee4e5a54a4882ebabf4`. Offer advanced nesting as an
  optional local optimiser for supported closed-outline/stock constraints.
  Keep the existing engine default and retain its best validated result when
  advanced processing fails, times out, or cannot represent a layout. Treat
  solver output as untrusted: independently validate counts, transforms,
  rotations, sheet boundaries, overlap and requested spacing before applying.
  Keep the native WASM unmodified; reproducibly adapt the JS Embind invoker to
  Emscripten 6.0.11's no-eval implementation so the worker obeys strict CSP.
- Fix existing rounded-offset nesting clearance using actual outline distance
  and raw-contour extrema. This is a correctness fix independent of the optimiser.

## Runtime and licence constraints

Both engines run locally, including offline after install/precache. Allow only
WASM compilation in CSP (`wasm-unsafe-eval`), not arbitrary JavaScript evaluation.
The workspace uses COOP `same-origin` and COEP `credentialless` for the solver's
SharedArrayBuffer workers. Credentialless keeps non-CORS camera previews usable
without cross-origin cookies. Payment pages do not receive workspace isolation
headers. Environments without isolation keep the existing nesting engine.

The solver adds a 7,446,905-byte WASM and 114,322-byte adapted loader; raise the individual
precache limit to 8 MiB. This exceeds the historic one-megabyte compressed total
target, so it is an explicit exception for offline advanced nesting, loaded only
when selected. No blanket dependency-budget relaxation is intended.

All adopted package licences are permissive. Add pako's exact `(MIT AND Zlib)`
expression after reviewing both terms; neither requires disclosure of KerfDesk
source. Unicode-3.0 data, HarfBuzz's native Old MIT text, MIT native solver
dependencies, and Emscripten/libc/libc++ runtime notices ship in generated notices.
Pinned asset hashes fail the notices build if native payloads drift.

The bidi adapter's Unicode-version limitations are documented, codepoint and
line handling are tested, and it remains replaceable independently of outline
geometry. The exact dependency audit is recorded in RESEARCH_LOG.md.

## Verification and boundaries

Use focused geometry, decoder, adapter and worker regressions, rendered browser
checks and production builds. Software verification is not machine qualification.
This work does not operate hardware, alter Frame/Start policy, add entitlement
gates, merge, deploy or publish a release.
