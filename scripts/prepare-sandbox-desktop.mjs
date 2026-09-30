// Generates an isolated, unsigned Windows qualification package. No live key,
// entitlement, provider setting or production preparation path is used here.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile } from '@electron/asar';
import { verifyDesktopRendererAsar } from './verify-desktop-renderer.mjs';
import {
  isSandboxMetadata,
  SANDBOX_APP_ID,
  SANDBOX_ENTITLEMENT_KEYS,
  SANDBOX_ORIGIN,
  SANDBOX_PACKAGE_NAME,
  SANDBOX_PRODUCT_NAME,
  SANDBOX_RELEASE_KEYS,
} from '../public/desktop-sandbox-contract.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const KEY_ID = 'sandbox-release-fixture-v1';
const SOURCE_REF = 'sandbox-qualification';
const requireSandbox = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Deliberately public fixture material, derived from this published label. It
// signs only the sandbox's release identity; production pins never accept it.
// The actual sandbox service entitlement private key is neither read nor shipped.
function fixtureKey() {
  const seed = createHash('sha256').update('KerfDesk public sandbox release fixture v1').digest();
  return createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

function identity(input) {
  requireSandbox(
    input.sandboxOnly === true,
    'Explicit --sandbox-only acknowledgement is required.',
  );
  requireSandbox(/^0\.0\.(0|[1-9]\d{0,4})$/u.test(input.version), 'Use a sandbox version 0.0.N.');
  requireSandbox(
    Number(input.version.split('.')[2]) <= 65535,
    'Sandbox version exceeds Windows limits.',
  );
  requireSandbox(/^[a-f0-9]{40}$/u.test(input.sourceSha), 'A 40-character source SHA is required.');
  const at = Date.parse(input.publishedAt);
  requireSandbox(
    Number.isFinite(at) && at > 0 && new Date(at).toISOString() === input.publishedAt,
    'A canonical UTC publication timestamp is required.',
  );
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'release-identity',
    channel: 'stable',
    version: input.version,
    sourceSha: input.sourceSha,
    sourceRef: SOURCE_REF,
    publishedAt: input.publishedAt,
  };
}

export function prepareSandboxMetadata(input) {
  const payload = Buffer.from(JSON.stringify(identity(input)));
  const key = fixtureKey();
  requireSandbox(
    createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64') ===
      SANDBOX_RELEASE_KEYS[KEY_ID],
    'Sandbox fixture key does not match its public pin.',
  );
  return {
    name: SANDBOX_PACKAGE_NAME,
    version: input.version,
    kerfdeskSandbox: true,
    kerfdeskUpdateChannelTrusted: false,
    kerfdeskDesktopReleaseChannel: 'sandbox',
    kerfdeskCommercialLicense: {
      schema: 1,
      apiOrigin: SANDBOX_ORIGIN,
      entitlementKeys: SANDBOX_ENTITLEMENT_KEYS,
      releaseKeys: SANDBOX_RELEASE_KEYS,
      release: {
        schemaVersion: 1,
        keyId: KEY_ID,
        algorithm: 'Ed25519',
        payload: payload.toString('base64'),
        signature: sign(null, payload, key).toString('base64'),
      },
    },
  };
}

export function verifySandboxMetadata(metadata) {
  requireSandbox(
    isSandboxMetadata(metadata),
    'Sandbox endpoint, identity, update policy or public pins differ.',
  );
  const envelope = metadata.kerfdeskCommercialLicense.release;
  requireSandbox(
    envelope?.schemaVersion === 1 && envelope.keyId === KEY_ID && envelope.algorithm === 'Ed25519',
    'Sandbox release identity is missing.',
  );
  const bytes = Buffer.from(envelope.payload, 'base64');
  const signature = Buffer.from(envelope.signature, 'base64');
  const key = createPublicKey({
    key: Buffer.from(SANDBOX_RELEASE_KEYS[KEY_ID], 'base64'),
    format: 'der',
    type: 'spki',
  });
  requireSandbox(
    signature.length === 64 && verify(null, bytes, key, signature),
    'Invalid sandbox release signature.',
  );
  const claims = JSON.parse(bytes.toString('utf8'));
  const expected = identity({ ...claims, sandboxOnly: true });
  requireSandbox(
    JSON.stringify(claims) === JSON.stringify(expected) && claims.version === metadata.version,
    'Sandbox release identity and package differ.',
  );
  return claims;
}

const within = (parent, child) => {
  const part = relative(parent, child);
  return part === '' || (part.split(/[\\/]/u)[0] !== '..' && !isAbsolute(part));
};

export async function writeSandboxPreparation(input, root = ROOT) {
  const metadata = prepareSandboxMetadata(input);
  const repository = await realpath(root);
  const output = resolve(input.outputDir);
  requireSandbox(!within(repository, output), 'Sandbox preparation must be outside the checkout.');
  // Resolve the nearest existing ancestor before creating anything, including symlinks.
  let ancestor = output;
  let physical;
  for (;;) {
    try {
      physical = await realpath(ancestor);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
      ancestor = dirname(ancestor);
    }
  }
  requireSandbox(
    !within(repository, resolve(physical, relative(ancestor, output))),
    'Sandbox preparation must be outside the checkout.',
  );
  await mkdir(output, { recursive: true });
  const configPath = join(await realpath(output), 'electron-builder.sandbox.generated.json');
  const bytes = `${JSON.stringify({ extends: join(repository, 'electron-builder.sandbox.yml'), extraMetadata: metadata }, null, 2)}\n`;
  try {
    await writeFile(configPath, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    requireSandbox(
      (await readFile(configPath, 'utf8')) === bytes,
      'Sandbox preparation already exists with different contents.',
    );
  }
  return { configPath, version: input.version, sandboxOnly: true };
}

/** Check the actual ASAR and effective builder identity before an installer can be made. */
export default async function verifySandboxPackage(context) {
  const config = context.packager.config;
  requireSandbox(
    context.electronPlatformName === 'win32',
    'Sandbox packaging supports Windows only.',
  );
  requireSandbox(
    config.appId === SANDBOX_APP_ID &&
      config.productName === SANDBOX_PRODUCT_NAME &&
      config.executableName === 'KerfDesk-Sandbox' &&
      config.forceCodeSigning === false &&
      config.publish === null &&
      Array.isArray(config.fileAssociations) &&
      config.fileAssociations.length === 0 &&
      config.nsis?.shortcutName === SANDBOX_PRODUCT_NAME &&
      config.nsis?.include === 'scripts/nsis-sandbox.nsh',
    'Sandbox installation must stay separate from production, without publishing or file associations.',
  );
  const metadata = JSON.parse(
    extractFile(join(context.appOutDir, 'resources/app.asar'), 'package.json').toString('utf8'),
  );
  const claims = verifySandboxMetadata(metadata);
  requireSandbox(
    claims.version === context.packager.appInfo.version,
    'Sandbox package version differs.',
  );
  verifyDesktopRendererAsar(join(context.appOutDir, 'resources/app.asar'));
  for (const [source, destination] of [
    ['LICENSE', 'LICENSE'],
    ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
    ['public/third-party-notices.txt', 'third-party-notices.txt'],
  ]) {
    const expected = await readFile(join(ROOT, source));
    const actual = await readFile(join(context.appOutDir, 'resources/legal', destination));
    requireSandbox(
      expected.length > 0 && actual.equals(expected),
      `Sandbox legal notice differs from its source: ${source}`,
    );
  }
}

export async function runSandboxPreparation(args, root = ROOT) {
  requireSandbox(
    args[0] === '--sandbox-only',
    'Explicit --sandbox-only acknowledgement is required.',
  );
  const names = {
    '--output-dir': 'outputDir',
    '--version': 'version',
    '--source-sha': 'sourceSha',
    '--published-at': 'publishedAt',
  };
  const input = { sandboxOnly: true };
  for (let i = 1; i < args.length; i += 2) {
    const field = names[args[i]];
    requireSandbox(
      field && args[i + 1] && !Object.hasOwn(input, field),
      'Invalid sandbox preparation arguments.',
    );
    input[field] = args[i + 1];
  }
  requireSandbox(
    Object.keys(input).length === 5,
    'All sandbox preparation arguments are required.',
  );
  return writeSandboxPreparation(input, root);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSandboxPreparation(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch(() => {
      console.error(
        'Sandbox preparation failed. Check the explicit sandbox flag, identity and external output directory.',
      );
      process.exitCode = 1;
    });
}
