import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractFile } from '@electron/asar';
import {
  CommercialReleaseError,
  validateCommercialPayload,
} from './commercial-release-manifest.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_ORIGIN = 'https://license.kerfdesk.com';
const CONFIG_NAME = 'electron-builder.commercial.generated.json';
const IDENTITY_NAME = 'commercial-release-identity.json';
const VERSION = /^(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})\.(0|[1-9]\d{0,15})$/u;
// Its own secret-free refusals; the publish CLI also prints them.
class PreparationError extends CommercialReleaseError {}
const requireInput = (condition, message) => {
  if (!condition) throw new PreparationError(message);
};
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function identity(input) {
  requireInput(
    typeof input.version === 'string' && VERSION.test(input.version),
    'A strict stable X.Y.Z version is required.',
  );
  requireInput(
    typeof input.sourceSha === 'string' && /^[a-f0-9]{40}$/u.test(input.sourceSha),
    'A lowercase 40-character source SHA is required.',
  );
  requireInput(
    typeof input.sourceRef === 'string' &&
      input.sourceRef.length > 0 &&
      input.sourceRef.length <= 200 &&
      !Array.from(input.sourceRef).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    'A bounded source ref is required.',
  );
  const time = Date.parse(input.publishedAt);
  requireInput(
    Number.isFinite(time) && time > 0 && new Date(time).toISOString() === input.publishedAt,
    'publishedAt must be a canonical UTC timestamp.',
  );
  return {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'release-identity',
    channel: 'stable',
    version: input.version,
    sourceSha: input.sourceSha,
    sourceRef: input.sourceRef,
    publishedAt: input.publishedAt,
  };
}

function decodeBase64(value) {
  requireInput(
    typeof value === 'string' && value.length > 0 && value.length < 16_384,
    'Invalid public signed data.',
  );
  const bytes = Buffer.from(value, 'base64');
  requireInput(bytes.toString('base64') === value, 'Invalid public signed data.');
  return bytes;
}

export function publicKeyRecord(keySet, channel) {
  requireInput(
    record(keySet) && keySet.schemaVersion === 1 && Array.isArray(keySet.keys),
    'Invalid public key catalog.',
  );
  const seen = new Set();
  const keys = {};
  for (const key of keySet.keys) {
    requireInput(
      record(key) && /^[a-z0-9-]{1,64}$/u.test(key.keyId ?? '') && !seen.has(key.keyId),
      'Invalid or duplicate public key identifier.',
    );
    seen.add(key.keyId);
    requireInput(key.algorithm === 'Ed25519', 'Public keys must use Ed25519.');
    if (channel === 'stable')
      requireInput(
        ['stable', 'preview'].includes(key.channel),
        'Release keys require an explicit channel.',
      );
    else
      requireInput(key.channel === undefined, 'Entitlement keys cannot be release-channel keys.');
    const publicKey = createPublicKey({
      key: decodeBase64(key.publicKeySpki),
      format: 'der',
      type: 'spki',
    });
    requireInput(publicKey.asymmetricKeyType === 'ed25519', 'Public keys must use Ed25519.');
    if (channel === undefined || key.channel === channel) keys[key.keyId] = key.publicKeySpki;
  }
  requireInput(
    Object.keys(keys).length > 0 && Object.keys(keys).length <= 8,
    'One to eight independently pinned public keys are required.',
  );
  return keys;
}

function trustedKeys(entitlementKeySet, releaseKeySet) {
  const entitlementKeys = publicKeyRecord(entitlementKeySet);
  const releaseKeys = publicKeyRecord(releaseKeySet, 'stable');
  requireInput(
    !Object.values(entitlementKeys).some((key) => Object.values(releaseKeys).includes(key)),
    'Entitlement and release signing keys must be separate.',
  );
  return { entitlementKeys, releaseKeys };
}

// The publisher checks this identity with validateCommercialPayload. Refuse here,
// before signing, what it would refuse: a source ref other than this version's
// tag, or a publication time more than five minutes ahead of this clock.
function requirePublishableIdentity(payload, now) {
  try {
    validateCommercialPayload(payload, 'release-identity', now);
  } catch (error) {
    if (!(error instanceof CommercialReleaseError)) throw error;
    throw new PreparationError(
      `The publisher would refuse this identity (${error.message}): the source ref must be refs/tags/v${payload.version} and publishedAt no more than five minutes ahead.`,
    );
  }
}

export function prepareCommercialMetadata(input, now = Date.now()) {
  const payload = identity(input);
  requirePublishableIdentity(payload, now);
  const keys = trustedKeys(input.entitlementKeySet, input.releaseKeySet);
  requireInput(
    Object.hasOwn(keys.releaseKeys, input.keyId),
    'The signing key must be independently pinned for stable releases.',
  );
  const key = createPrivateKey(input.privateKeyPem);
  requireInput(key.asymmetricKeyType === 'ed25519', 'The release signing key must use Ed25519.');
  const publicSpki = createPublicKey(key)
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
  requireInput(
    publicSpki === keys.releaseKeys[input.keyId],
    'The private signing key does not match the pinned stable key.',
  );
  const bytes = Buffer.from(JSON.stringify(payload));
  const envelope = {
    schemaVersion: 1,
    keyId: input.keyId,
    algorithm: 'Ed25519',
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, key).toString('base64'),
  };
  return {
    version: input.version,
    kerfdeskUpdateChannelTrusted: true,
    kerfdeskDesktopReleaseChannel: 'stable',
    kerfdeskCommercialLicense: { schema: 1, apiOrigin: API_ORIGIN, ...keys, release: envelope },
  };
}

export function verifyCommercialMetadata(metadata, entitlementKeySet, releaseKeySet) {
  const keys = trustedKeys(entitlementKeySet, releaseKeySet);
  const commercial = metadata?.kerfdeskCommercialLicense;
  requireInput(
    record(commercial) && commercial.schema === 1 && commercial.apiOrigin === API_ORIGIN,
    'Commercial licensing metadata is missing or invalid.',
  );
  requireInput(
    metadata.kerfdeskUpdateChannelTrusted === true &&
      metadata.kerfdeskDesktopReleaseChannel === 'stable',
    'Commercial update-channel trust is invalid.',
  );
  for (const field of ['entitlementKeys', 'releaseKeys'])
    requireInput(
      record(commercial[field]) &&
        Object.keys(commercial[field]).length === Object.keys(keys[field]).length &&
        Object.entries(keys[field]).every(([id, value]) => commercial[field][id] === value),
      'Packaged public keys differ from the pinned commercial keys.',
    );
  const envelope = commercial.release;
  requireInput(
    record(envelope) &&
      envelope.schemaVersion === 1 &&
      envelope.algorithm === 'Ed25519' &&
      Object.hasOwn(keys.releaseKeys, envelope.keyId),
    'A stable signed release identity is required.',
  );
  const payload = decodeBase64(envelope.payload);
  const signature = decodeBase64(envelope.signature);
  const key = createPublicKey({
    key: decodeBase64(keys.releaseKeys[envelope.keyId]),
    format: 'der',
    type: 'spki',
  });
  requireInput(
    signature.length === 64 && verify(null, payload, key, signature),
    'Release identity signature is invalid.',
  );
  const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  const expected = identity(claims);
  requireInput(
    Object.keys(claims).length === Object.keys(expected).length &&
      Object.entries(expected).every(([field, value]) => claims[field] === value) &&
      claims.version === metadata.version,
    'Packaged version and signed release identity differ.',
  );
  return claims;
}

async function boundedFile(path, limit) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    requireInput(
      stat.isFile() && stat.size > 0 && stat.size <= limit,
      'An input file is empty, oversized, or not a regular file.',
    );
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    requireInput(length > 0 && length <= limit, 'An input file is empty or oversized.');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally {
    await handle.close();
  }
}

function within(parent, child) {
  const difference = relative(parent, child);
  return difference === '' || (difference.split(/[\\/]/u)[0] !== '..' && !isAbsolute(difference));
}

async function externalPath(path, root, directory = false) {
  const target = resolve(path);
  const realRoot = await realpath(root);
  requireInput(
    !within(realRoot, target),
    'Generated files and commercial terms must be outside the repository.',
  );
  let ancestor = directory ? target : dirname(target);
  let existing;
  for (;;) {
    try {
      existing = await realpath(ancestor);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
      ancestor = dirname(ancestor);
    }
  }
  const physical = resolve(existing, relative(ancestor, target));
  requireInput(
    !within(realRoot, physical),
    'Generated files and commercial terms must be outside the repository.',
  );
  return physical;
}

async function publicCatalogs(root) {
  return {
    entitlementKeySet: JSON.parse(
      await boundedFile(join(root, 'public/desktop-licence-keys.json'), 16_384),
    ),
    releaseKeySet: JSON.parse(
      await boundedFile(join(root, 'public/desktop-release-keys.json'), 16_384),
    ),
  };
}

export async function writeCommercialPreparation(input, root = ROOT) {
  const output = await externalPath(input.outputDir, root, true);
  const terms = await realpath(await externalPath(input.termsFile, root));
  requireInput(
    !within(await realpath(root), terms),
    'Commercial terms must be outside the repository.',
  );
  const termsText = await boundedFile(terms, 262_144);
  requireInput(
    termsText.trim().length > 0 && !termsText.includes('\0'),
    'Commercial terms must contain nonempty UTF-8 text.',
  );
  const metadata = prepareCommercialMetadata(input);
  const config = {
    extends: join(await realpath(root), 'electron-builder.commercial.yml'),
    extraMetadata: metadata,
    nsis: { license: terms },
  };
  const artifacts = [
    { path: join(output, CONFIG_NAME), bytes: `${JSON.stringify(config, null, 2)}\n` },
    {
      path: join(output, IDENTITY_NAME),
      bytes: `${JSON.stringify(metadata.kerfdeskCommercialLicense.release, null, 2)}\n`,
    },
  ];
  // Detect conflicts before writing anything; identical retries reuse the exact
  // signed timestamp and metadata rather than silently resigning a version.
  for (const item of artifacts) {
    try {
      requireInput(
        (await readFile(item.path, 'utf8')) === item.bytes,
        'Generated artifact already exists with different contents.',
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await mkdir(output, { recursive: true });
  requireInput(
    !within(await realpath(root), await realpath(output)),
    'Generated artifacts must be outside the repository.',
  );
  for (const item of artifacts) {
    try {
      await writeFile(item.path, item.bytes, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireInput(
        (await readFile(item.path, 'utf8')) === item.bytes,
        'Generated artifact changed during preparation.',
      );
    }
  }
  return {
    version: metadata.version,
    configPath: artifacts[0].path,
    identityPath: artifacts[1].path,
  };
}

// electron-builder afterPack hook: inspect the bytes actually written to ASAR,
// not only the prebuild input. Code signing still occurs after this hook.
export default async function verifyCommercialPackage(context) {
  requireInput(
    context.electronPlatformName === 'win32',
    'Commercial packaging currently supports Windows only.',
  );
  const metadata = JSON.parse(
    extractFile(join(context.appOutDir, 'resources', 'app.asar'), 'package.json').toString('utf8'),
  );
  const root = context.packager.projectDir;
  const catalogs = await publicCatalogs(root);
  const claims = verifyCommercialMetadata(
    metadata,
    catalogs.entitlementKeySet,
    catalogs.releaseKeySet,
  );
  requireInput(
    claims.version === context.packager.appInfo.version,
    'The actual packaged version does not match the signed identity.',
  );
  const terms = context.packager.config.nsis?.license;
  requireInput(
    typeof terms === 'string' && isAbsolute(terms),
    'Explicit commercial terms are required.',
  );
  const realTerms = await realpath(await externalPath(terms, root));
  requireInput(
    !within(await realpath(root), realTerms) &&
      (await boundedFile(realTerms, 262_144)).trim().length > 0,
    'Explicit external commercial terms are required.',
  );
}

export async function runPreparation(args, env = process.env, root = ROOT) {
  const names = {
    '--output-dir': 'outputDir',
    '--terms-file': 'termsFile',
    '--version': 'version',
    '--source-sha': 'sourceSha',
    '--source-ref': 'sourceRef',
    '--published-at': 'publishedAt',
    '--key-id': 'keyId',
  };
  const input = {};
  for (let index = 0; index < args.length; index += 2) {
    const field = names[args[index]];
    requireInput(
      field && args[index + 1] && !Object.hasOwn(input, field),
      'Usage: prepare-commercial-desktop.mjs --output-dir <external-dir> --terms-file <external-terms.txt> --version <X.Y.Z> --source-sha <sha> --source-ref refs/tags/v<X.Y.Z> --published-at <canonical-UTC> --key-id <stable-key-id>',
    );
    input[field] = args[index + 1];
  }
  requireInput(
    Object.keys(input).length === Object.keys(names).length,
    'All commercial preparation arguments are required.',
  );
  const inline = env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY;
  const file = env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY_FILE;
  requireInput(
    Boolean(inline) !== Boolean(file),
    'Set exactly one protected stable signing-key environment source.',
  );
  const privateKeyPem = file ? await boundedFile(file, 16_384) : inline;
  requireInput(
    typeof privateKeyPem === 'string' && privateKeyPem.length <= 16_384,
    'Invalid signing-key input.',
  );
  return writeCommercialPreparation(
    { ...input, ...(await publicCatalogs(root)), privateKeyPem },
    root,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runPreparation(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      // Never print crypto/parser exceptions, input documents, or signing material.
      console.error(
        error instanceof PreparationError
          ? error.message
          : 'Commercial preparation failed. Check the protected signing key and input files.',
      );
      process.exitCode = 1;
    });
}
