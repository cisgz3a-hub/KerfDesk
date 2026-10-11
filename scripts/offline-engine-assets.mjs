// Pinned native payloads sit outside pnpm's package-licence closure (ADR-591).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const PACKING_SOLVER_SOURCE =
  'https://github.com/fontanf/packingsolver/commit/49bf6c7d9d2204f17d698ee4e5a54a4882ebabf4';
export const OFFLINE_ENGINE_ASSETS = [
  {
    file: 'public/vendor/packingsolver/49bf6c7/packingsolver.js',
    sha256: 'ef8b003ac26aa8c9e074726e293f011a532b9dfe8d7726eaa24eec08897570d4',
  },
  {
    file: 'scripts/vendor/packingsolver-49bf6c7.upstream.js',
    sha256: '27a920820ebd0f537466843f83cd026946ece227e92f4ba34c9967cc4c6fd5a3',
  },
  {
    file: 'public/vendor/packingsolver/49bf6c7/packingsolver.wasm',
    sha256: 'a702f2576b758a8971e0191b1bb6e9fd92da32d0d7a28310fb4e66332b56c055',
  },
  {
    file: 'node_modules/harfbuzzjs/dist/harfbuzz.wasm',
    sha256: '5f67e3bd1c4f40ffd07c12d7faa30ebc40cc65998ce058fde5b3c6504607bfb4',
  },
];

const LICENSE_FILES = [
  'HarfBuzz-COPYING.txt',
  'Unicode-3.0.txt',
  'packingsolver-packingsolver.txt',
  'packingsolver-optimizationtools.txt',
  'packingsolver-shape.txt',
  'packingsolver-highs.txt',
  'packingsolver-mathoptsolverscmake.txt',
  'packingsolver-knapsacksolver.txt',
  'packingsolver-multiplechoicesubsetsumsolver.txt',
  'packingsolver-subsetsumsolver.txt',
  'packingsolver-treesearchsolver.txt',
  'packingsolver-columngenerationsolver.txt',
  'packingsolver-nlohmann-json.txt',
  'emscripten-LICENSE.txt',
  'emscripten-system-lib-libc-musl-COPYRIGHT.txt',
  'emscripten-system-lib-libcxx-LICENSE.TXT.txt',
  'emscripten-system-lib-libcxxabi-LICENSE.TXT.txt',
  'emscripten-system-lib-compiler-rt-LICENSE.TXT.txt',
  'emscripten-system-lib-mimalloc-LICENSE.txt',
];

export function verifyOfflineEngineAssets(rootDir) {
  for (const asset of OFFLINE_ENGINE_ASSETS) {
    const actual = createHash('sha256')
      .update(fs.readFileSync(path.join(rootDir, asset.file)))
      .digest('hex');
    if (actual !== asset.sha256) throw new Error(`pinned engine hash changed: ${asset.file}`);
  }
}

export function offlineEngineNotices(rootDir) {
  verifyOfflineEngineAssets(rootDir);
  return [
    '== Offline text and nesting engines ==',
    `PackingSolver source: ${PACKING_SOLVER_SOURCE}`,
    'Official WebAssembly artifact: GitHub Actions run 38124619297, artifact site. WASM unchanged; JS Embind invoker adapted to the upstream no-eval implementation by scripts/prepare-packing-solver.mjs.',
    'HarfBuzz native source: https://github.com/harfbuzz/harfbuzz/tree/c7a7457b7385f33178e8cf87615ca077a810bbe7',
    'Unicode script data: https://www.unicode.org/Public/17.0.0/ucd/',
    'Emscripten runtime notices: https://github.com/emscripten-core/emscripten/tree/6.0.11/system/lib',
    ...OFFLINE_ENGINE_ASSETS.map((asset) => `${asset.file}: SHA-256 ${asset.sha256}`),
    ...LICENSE_FILES.map(
      (file) =>
        `--- Native component licence: ${file} ---\n` +
        fs.readFileSync(path.join(rootDir, 'scripts/license-texts', file), 'utf8').trim(),
    ),
  ];
}
