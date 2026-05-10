/**
 * T3-4: regression contracts for the code-signing infrastructure.
 *
 * The signed-builder configs + npm scripts + env validator all need
 * to stay aligned: a signed build pipeline that silently slips into
 * "build but skip signing" mode (because someone deleted the wrong
 * line) defeats the entire ticket. These contracts pin:
 *
 *   - The signed-builder configs extend package.json's base build
 *     and apply the right per-platform fields (sha256 + publisherName,
 *     hardenedRuntime + entitlements + notarize.teamId).
 *   - The npm scripts wire --config to the signed-builder configs and
 *     run the env validator first so an unset cert is a hard error.
 *   - The validator exits non-zero with a named-var error when the
 *     env is empty and zero when the env is populated.
 *   - docs/CODE-SIGNING.md exists and references both Windows and
 *     macOS provisioning (so the validator's "see docs" pointer
 *     resolves to a real document).
 *
 * Run: npx tsx tests/code-signing-config.test.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T3-4 code-signing infrastructure ===\n');

// -------- npm scripts wired into package.json --------
{
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
    build: Record<string, unknown>;
  };
  const scripts = pkg.scripts;
  assert(typeof scripts['electron:validate-sign:win'] === 'string',
    'package.json defines electron:validate-sign:win');
  assert(typeof scripts['electron:validate-sign:mac'] === 'string',
    'package.json defines electron:validate-sign:mac');
  assert(typeof scripts['electron:build:signed:win'] === 'string',
    'package.json defines electron:build:signed:win');
  assert(typeof scripts['electron:build:signed:mac'] === 'string',
    'package.json defines electron:build:signed:mac');

  const winSigned = scripts['electron:build:signed:win'] ?? '';
  assert(winSigned.includes('electron:validate-sign:win'),
    'signed:win runs the env validator before build');
  assert(winSigned.includes('scripts/signing/electron-builder.windows-signed.cjs'),
    'signed:win passes --config to the windows-signed builder');

  const macSigned = scripts['electron:build:signed:mac'] ?? '';
  assert(macSigned.includes('electron:validate-sign:mac'),
    'signed:mac runs the env validator before build');
  assert(macSigned.includes('scripts/signing/electron-builder.macos-signed.cjs'),
    'signed:mac passes --config to the macos-signed builder');
}

// -------- signed-builder configs extend the base build correctly --------
{
  const winConfig = require(resolve(repoRoot, 'scripts/signing/electron-builder.windows-signed.cjs')) as {
    win?: {
      signAndEditExecutable?: boolean;
      signtoolOptions?: { publisherName?: string; signingHashAlgorithms?: string[] };
    };
    appId?: string;
  };
  assert(winConfig.appId === 'com.laserforge.app',
    'windows-signed config inherits appId from package.json base');
  assert(winConfig.win?.signAndEditExecutable === true,
    'windows-signed config enables signAndEditExecutable');
  assert(winConfig.win?.signtoolOptions?.publisherName === 'LaserForge',
    'windows-signed config sets publisherName for signtool');
  assert(Array.isArray(winConfig.win?.signtoolOptions?.signingHashAlgorithms)
    && winConfig.win!.signtoolOptions!.signingHashAlgorithms!.includes('sha256'),
    'windows-signed config requests sha256 hash algorithm');

  const macConfig = require(resolve(repoRoot, 'scripts/signing/electron-builder.macos-signed.cjs')) as {
    mac?: {
      hardenedRuntime?: boolean;
      entitlements?: string;
      entitlementsInherit?: string;
      notarize?: { teamId?: string };
      identity?: string;
    };
    appId?: string;
  };
  assert(macConfig.appId === 'com.laserforge.app',
    'macos-signed config inherits appId from package.json base');
  assert(macConfig.mac?.hardenedRuntime === true,
    'macos-signed config enables hardenedRuntime');
  assert(macConfig.mac?.entitlements === 'scripts/signing/entitlements.mac.plist',
    'macos-signed config points at the entitlements plist');
  assert(macConfig.mac?.entitlementsInherit === 'scripts/signing/entitlements.mac.plist',
    'macos-signed config sets entitlementsInherit so embedded binaries inherit too');
  assert('notarize' in (macConfig.mac ?? {}),
    'macos-signed config opts into notarization');
}

// -------- entitlements plist exists and grants the JIT entitlements V8 needs --------
{
  const plistPath = resolve(repoRoot, 'scripts/signing/entitlements.mac.plist');
  assert(existsSync(plistPath), 'entitlements.mac.plist exists');
  const plist = readFileSync(plistPath, 'utf-8');
  assert(plist.includes('com.apple.security.cs.allow-jit'),
    'entitlements grant allow-jit (V8 needs this under hardenedRuntime)');
  assert(plist.includes('com.apple.security.cs.allow-unsigned-executable-memory'),
    'entitlements grant allow-unsigned-executable-memory (V8 needs this too)');
}

// -------- docs exist and cover both platforms --------
{
  const docsPath = resolve(repoRoot, 'docs/CODE-SIGNING.md');
  assert(existsSync(docsPath), 'docs/CODE-SIGNING.md exists');
  const docs = readFileSync(docsPath, 'utf-8');
  assert(/##\s*Windows/i.test(docs), 'docs cover Windows section');
  assert(/##\s*macOS/i.test(docs), 'docs cover macOS section');
  assert(docs.includes('WIN_CSC_LINK'), 'docs name WIN_CSC_LINK env var');
  assert(docs.includes('APPLE_TEAM_ID'), 'docs name APPLE_TEAM_ID env var');
  assert(docs.includes('hardenedRuntime'), 'docs explain the hardenedRuntime requirement');
}

// -------- validator script behavior --------
{
  const validatorPath = resolve(repoRoot, 'scripts/signing/validate-signing-env.mjs');
  assert(existsSync(validatorPath), 'validator script exists');

  // Empty env → exit 1 + names the missing vars.
  const winEmpty = runValidator(['--platform=win'], emptyEnv());
  assert(winEmpty.code === 1, 'win validator exits 1 when env is empty');
  assert(winEmpty.stderr.includes('WIN_CSC_LINK') && winEmpty.stderr.includes('CSC_KEY_PASSWORD'),
    'win validator names the missing cert + password vars');
  assert(winEmpty.stderr.includes('docs/CODE-SIGNING.md'),
    'win validator points at the docs in its error output');

  const macEmpty = runValidator(['--platform=mac'], emptyEnv());
  assert(macEmpty.code === 1, 'mac validator exits 1 when env is empty');
  assert(macEmpty.stderr.includes('MAC_SIGNING_IDENTITY'),
    'mac validator names MAC_SIGNING_IDENTITY when missing');
  assert(macEmpty.stderr.includes('APPLE_TEAM_ID'),
    'mac validator names APPLE_TEAM_ID when missing');

  // Populated env → exit 0.
  const winFull = runValidator(['--platform=win'], {
    ...emptyEnv(),
    WIN_CSC_LINK: 'C:/fake/cert.pfx',
    WIN_CSC_KEY_PASSWORD: 'fake-pw',
  });
  assert(winFull.code === 0, 'win validator exits 0 when both required vars are set');
  assert(winFull.stdout.includes('ready to sign'),
    'win validator prints success message');

  const macFull = runValidator(['--platform=mac'], {
    ...emptyEnv(),
    MAC_SIGNING_IDENTITY: 'Developer ID Application: Test (TEAMID)',
    APPLE_ID: 'test@example.com',
    APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop',
    APPLE_TEAM_ID: 'TEAMID1234',
  });
  assert(macFull.code === 0, 'mac validator exits 0 when all four required vars are set');

  // Empty-string is treated the same as unset.
  const winBlank = runValidator(['--platform=win'], {
    ...emptyEnv(),
    WIN_CSC_LINK: '',
    WIN_CSC_KEY_PASSWORD: '   ',
  });
  assert(winBlank.code === 1, 'win validator treats empty/whitespace env values as missing');

  // Unknown platform → exit 2.
  const bad = runValidator(['--platform=bogus'], emptyEnv());
  assert(bad.code === 2, 'unknown --platform exits 2');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

// ─── helpers ─────────────────────────────────────────────────────

interface ValidatorRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runValidator(args: string[], env: NodeJS.ProcessEnv): ValidatorRun {
  const validatorPath = resolve(repoRoot, 'scripts/signing/validate-signing-env.mjs');
  try {
    const stdout = execFileSync(process.execPath, [validatorPath, ...args], {
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const error = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: error.status ?? -1,
      stdout: typeof error.stdout === 'string' ? error.stdout : (error.stdout?.toString('utf-8') ?? ''),
      stderr: typeof error.stderr === 'string' ? error.stderr : (error.stderr?.toString('utf-8') ?? ''),
    };
  }
}

/**
 * Strip every signing-related env var from the parent process so the
 * validator can't accidentally read a real local cert during the test.
 * Keep PATH so node + the validator can resolve, plus a clean PWD.
 */
function emptyEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  if (process.env.PATH) out.PATH = process.env.PATH;
  if (process.env.SystemRoot) out.SystemRoot = process.env.SystemRoot;
  return out;
}
