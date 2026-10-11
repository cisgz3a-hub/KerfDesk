# PackingSolver WebAssembly

The source payloads came from the `site` artifact of the official
[`fontanf/packingsolver` run 38124619297](https://github.com/fontanf/packingsolver/actions/runs/38124619297),
artifact ID `11696469458`, downloaded on 2026-10-11.

Source commit: `49bf6c7d9d2204f17d698ee4e5a54a4882ebabf4`.
Build: `.github/workflows/wasm.yml`, Emscripten `6.0.11`:

```sh
emcmake cmake -S . -B build_wasm -DCMAKE_BUILD_TYPE=Release -DPACKINGSOLVER_BUILD_WASM=ON
cmake --build build_wasm --target PackingSolver_wasm --parallel 4
```

Only the JS loader and WASM are included; no upstream application, images, or
example data are distributed. `scripts/offline-engine-assets.mjs` verifies their
SHA-256 hashes whenever release notices are generated. The generated
`third-party-notices.txt` includes PackingSolver, its pinned MIT solver libraries,
HiGHS 1.13.1, nlohmann/json 3.11.3, and Emscripten runtime notices. Source dependency
pins are in the exact commit's `extern/CMakeLists.txt`; its first FetchContent
declarations take precedence over later declarations in nested dependencies.

The WASM is unmodified. The shipped JavaScript replaces Embind's dynamically
generated invoker with the corresponding `DYNAMIC_EXECUTION=0` implementation
from Emscripten 6.0.11 `src/lib/libembind.js`, and removes its unused dynamic
factory. This preserves strict CSP without `unsafe-eval`. The exact original
loader is retained at `scripts/vendor/packingsolver-49bf6c7.upstream.js`.
Run `node scripts/prepare-packing-solver.mjs --check` to verify the deterministic
adaptation. The source branch assumes the artifact's existing no-ASYNCIFY,
no-tracing, no-assertions build configuration. It is a reviewed glue adaptation,
not a claim that a new native WASM binary was compiled locally.

The module starts 32 pthread workers on demand. KerfDesk loads it only when the
advanced nesting option is used, inside an owned worker that is terminated on
completion/cancellation. No remote service receives the design.
