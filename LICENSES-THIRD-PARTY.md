# Third-Party Licenses and Attributions

LaserForge uses third-party open-source libraries. This document lists all
commercial-compatible dependencies and the attributions required by their licenses.

## License Policy

LaserForge only uses dependencies with commercial-friendly licenses:

### Allowed

- MIT / MIT-0
- ISC
- Apache 2.0
- BSD 2-Clause / 3-Clause
- 0BSD / Unlicense
- CC0-1.0
- Boost Software License
- Python Software Foundation License

### Forbidden (viral copyleft — would force LaserForge to become GPL)

- GPL 2.0, GPL 3.0
- AGPL 3.0
- SSPL
- Commons Clause / Source-available licenses

### Case-by-case review

- LGPL (only if dynamically linked — rare in JS ecosystem)
- MPL 2.0 (file-level, safe if kept separate)

## Automated Verification

License compliance is enforced via:

- `npm run license-check` — blocks CI builds if any non-allowed license is detected
- Pre-commit hook — blocks commits with non-compliant dependencies
- Weekly scheduled CI check — catches licenses changed by transitive updates

## Full License Report

A machine-readable CSV report of all dependencies and their licenses is
generated on every CI run and available as a GitHub Actions artifact
(`licenses-report.csv`).

## Key Algorithm Attributions

These attributions are not legally required (the algorithms are public-domain
mathematics), but are included for academic honesty.

### Dithering algorithms (`src/import/Dithering.ts`)

Implemented from published academic papers:

- Floyd, R.W. & Steinberg, L. (1976). "An adaptive algorithm for spatial greyscale."
- Jarvis, J.F., Judice, C.N., Ninke, W.H. (1976). "A survey of techniques for the display of continuous tone pictures on bilevel displays."
- Stucki, P. (1981). "MECCA — A multiple-error correcting computation algorithm."
- Atkinson, B. (Apple, 1980s). Unpublished algorithm.
- Burkes, D. (1988). "Presentation of the Burkes error filter."
- Sierra, F. (1989-1990). Various kernel publications.
- Bayer, B.E. (1973). "An optimum method for two-level rendition of continuous-tone pictures." (Patent US3971065, expired 1986.)

### GRBL streaming protocol (`src/controllers/grbl/GrblController.ts`)

Based on public specification:

- Jeon, S.K. / gnea (2011-present). "Grbl v1.1 Interface Reference."
  Original stream.py is MIT licensed. Algorithm is a published protocol spec.

### Bitmap-to-vector tracing (`src/import/trace/ImageTracerAdapter.ts`, `imagetracerjs`)

Raster tracing uses [imagetracerjs](https://github.com/jankovicsandras/imagetracerjs) (Unlicense / public domain). The adapter exposes a small potrace-shaped API so path conversion code stays unchanged.

### Polygon/bin-packing (future — `src/core/plan/Nesting.ts`)

Implemented from public-domain algorithms:

- Burke, E.K., Hellier, R., Kendall, G., Whitwell, G. (2006). "A new bottom-left-fill heuristic algorithm for the two-dimensional irregular packing problem."

### Contrast/Gamma formulas (`src/core/image/ImageProcessing.ts`)

Standard image processing formulas, not novel or copyrightable:

- Contrast: `f(v) = 259(c+255) / (255(259-c)) · (v-128) + 128`
- Gamma: `f(v) = 255 · (v/255)^(1/γ)`

## Runtime Dependencies

Auto-generated license report available in CI artifacts. Major dependencies:

| Package | License | Purpose |
|---------|---------|---------|
| electron | MIT | Desktop app framework |
| react | MIT | UI framework |
| vite | MIT | Build tool |
| typescript | Apache-2.0 | Language |
| imagetracerjs | Unlicense | Bitmap tracing |
| (see licenses-report.csv for complete list) | | |

---

© 2025 LaserForge. All original LaserForge source code is proprietary.
