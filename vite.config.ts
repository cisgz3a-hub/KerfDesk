import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import packageJson from './package.json' with { type: 'json' };

// T1-112: stamp the build with the short git commit hash + ISO date
// so testers can read which commit is loaded straight off the canvas.
// Falls back to 'dev' / current time when not in a git tree (e.g.
// `npm run dev` outside a clone, or shallow CI checkouts that didn't
// fetch history). The fallback never breaks the build — that's the
// whole reason this is wrapped in try/catch.
function readGit(cmd: string, fallback: string): string {
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || fallback;
  } catch {
    return fallback;
  }
}

const buildCommit = readGit('git rev-parse --short HEAD', 'dev');
const buildTime = readGit('git log -1 --format=%cI', new Date().toISOString());

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // T2-105: hidden renderer maps support crash symbolication while keeping
    // the runtime bundle free of //# sourceMappingURL references. The maps
    // are generated in dist/ for post-build tooling, then excluded from
    // packaged installers by package.json:build.files negation globs.
    sourcemap: 'hidden',
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    // T1-112: build stamp consumed by src/ui/components/BuildStamp.tsx.
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    port: 3000,
    open: true,
  },
});
