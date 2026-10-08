import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value, depth = 0) => {
  assert.ok(depth <= 32, 'Sandbox protection data exceeds bounds.');
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key], depth + 1)]),
    );
  return value;
};
export const sandboxSettingsFingerprint = (settings) => {
  const protectedFields = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !['annotations', 'exports_reconciliation'].includes(key),
    ),
  );
  protectedFields.bindings = settings.bindings
    .map((value) => canonical(value))
    .sort((a, b) => a.name.localeCompare(b.name));
  return hash(JSON.stringify(canonical(protectedFields)));
};

const safeBindingNames = [
  'LICENSING_ENABLED',
  'PAYMENTS_ENABLED',
  'PADDLE_ENVIRONMENT',
  'SIGNING_KEY_ID',
  'PAYMENT_PROVIDER',
  'TRIALS_ENABLED',
  'PADDLE_PURCHASE_PRICE_ID',
  'PADDLE_RENEWAL_PRICE_ID',
  'PADDLE_CHECKOUT_URL',
  'SIGNING_PRIVATE_JWK',
  'ADMIN_TOKEN',
  'HASH_SECRET',
  'DERIVATION_SECRET',
  'PADDLE_API_KEY',
  'PADDLE_CLIENT_TOKEN',
  'PADDLE_WEBHOOK_SECRET',
  'LICENSE_AUTHORITY',
  'ASSETS',
  'REQUEST_RATE_LIMITER',
  'WEBHOOK_RATE_LIMITER',
  'TRIAL_RATE_LIMITER',
];
export const sandboxReceiptBindingName = (name) => (safeBindingNames.includes(name) ? name : null);

const safeBindingTypes = [
  'plain_text',
  'secret_text',
  'secret_key',
  'json',
  'durable_object_namespace',
  'ratelimit',
  'assets',
  'service',
];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const optional = (value) => (value === null ? undefined : value);
const date = (value) => {
  if (typeof value !== 'string') return undefined;
  const result = value.replace(/T00:00:00(?:\.000)?Z$/u, '');
  return /^\d{4}-\d{2}-\d{2}$/u.test(result) &&
    new Date(result).toISOString().slice(0, 10) === result
    ? result
    : undefined;
};
function placement(script) {
  if (script.placement != null) return script.placement;
  if (script.placement_mode === 'smart') return { mode: 'smart' };
  if (script.placement_mode === undefined || script.placement_mode === 'off')
    return { mode: 'off' };
  return null;
}

// /settings combines script-level settings with version data but has no version identity.
// This comparison binds the protected values to the exact UUID used for inheritance.
export function attestSandboxVersion(
  version,
  expectedVersion,
  settings,
  diagnostic = {},
  previous,
) {
  const bindings = version?.resources?.bindings;
  const runtime = version?.resources?.script_runtime;
  const script = version?.resources?.script;
  const shaped = (items) =>
    Array.isArray(items) &&
    items.length <= 128 &&
    items.every(
      (item) =>
        object(item) &&
        typeof item.name === 'string' &&
        item.name.length > 0 &&
        item.name.length <= 128 &&
        typeof item.type === 'string',
    ) &&
    new Set(items.map(({ name }) => name)).size === items.length;
  const available =
    shaped(bindings) && shaped(settings?.bindings) && object(runtime) && object(script);
  const valuesEqual = {};
  let bindingsEqual = false;
  let snapshot;
  const differences = [];
  if (available) {
    try {
      assert.ok(
        JSON.stringify({
          bindings,
          runtime,
          script,
          cache_options: version.cache_options,
          settings,
        }).length <= 1048576,
      );
      const expected = new Map(settings.bindings.map((binding) => [binding.name, binding]));
      const observed = new Map(bindings.map((binding) => [binding.name, binding]));
      for (const name of new Set([...expected.keys(), ...observed.keys()])) {
        const a = expected.get(name);
        const b = observed.get(name);
        const valueEqual = equal(a, b);
        if (!valueEqual)
          differences.push({
            name: sandboxReceiptBindingName(name),
            expectedType: safeBindingTypes.includes(a?.type) ? a.type : null,
            observedType: safeBindingTypes.includes(b?.type) ? b.type : null,
            valueEqual,
          });
      }
      bindingsEqual = differences.length === 0;
      const runtimeDate = date(runtime.compatibility_date);
      const runtimeFlags = runtime.compatibility_flags ?? [];
      valuesEqual.compatibility_date =
        Boolean(runtimeDate) && runtimeDate === date(settings.compatibility_date);
      valuesEqual.compatibility_flags =
        Array.isArray(runtimeFlags) && equal(runtimeFlags, settings.compatibility_flags);
      valuesEqual.usage_model = equal(runtime.usage_model, settings.usage_model);
      valuesEqual.limits = equal(optional(runtime.limits), optional(settings.limits));
      valuesEqual.placement = equal(
        placement(script),
        optional(settings.placement) ?? { mode: 'off' },
      );
      valuesEqual.cache_options = equal(
        optional(version.cache_options),
        optional(settings.cache_options),
      );
      snapshot = canonical({
        runtime: {
          ...runtime,
          compatibility_date: runtimeDate,
          compatibility_flags: runtimeFlags,
          limits: optional(runtime.limits),
        },
        placement: placement(script),
        cache_options: optional(version.cache_options),
        named_handlers: script.named_handlers,
      });
      if (previous) valuesEqual.originalVersionResources = equal(snapshot, previous);
    } catch {
      snapshot = undefined;
    }
  }
  const idEqual =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(expectedVersion) &&
    version?.id === expectedVersion;
  Object.assign(diagnostic, {
    idEqual,
    resourcesAvailable: Boolean(available),
    bindingsEqual,
    bindings: differences.slice(0, 32),
    truncated: differences.length > 32,
    valuesEqual,
  });
  assert.ok(
    idEqual &&
      available &&
      bindingsEqual &&
      snapshot &&
      Object.values(valuesEqual).every((value) => value === true),
    'Sandbox version protections disagree.',
  );
  return snapshot;
}

export async function readAttestedSandboxModule(
  response,
  expectedSha,
  format = {},
  expectedRawDescriptor,
) {
  const mimeType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  const safeName = (name) =>
    ['worker.js', 'sandbox-worker.js', 'worker.js.map', 'sandbox-worker.js.map'].includes(name)
      ? name
      : null;
  const safeMime = (type) =>
    [
      'multipart/form-data',
      'application/javascript',
      'application/javascript+module',
      'text/javascript+module',
      'text/javascript',
      'application/source-map',
      'application/json',
      'text/html',
      'application/octet-stream',
    ].includes(type)
      ? type
      : null;
  format.contentType = safeMime(mimeType);
  format.entrypoint = safeName(response.headers.get('cf-entrypoint'));
  assert.ok(response.ok, 'Sandbox module unavailable.');
  if (mimeType !== 'multipart/form-data') {
    assert.ok(
      ['application/javascript', 'application/javascript+module'].includes(mimeType),
      'Expected a JavaScript module response.',
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    format.partCount = 0;
    format.raw = { size: bytes.length, sha256: hash(bytes) };
    assert.ok(bytes.length, 'Sandbox module empty.');
    assert.equal(format.raw.sha256, expectedSha, 'Sandbox module is not the attested code.');
    const descriptor = expectedRawDescriptor ?? {
      entrypoint: 'sandbox-worker.js',
      filename: 'sandbox-worker.js',
      mimeType: 'application/javascript+module',
    };
    if (expectedRawDescriptor) {
      const header = response.headers.get('cf-entrypoint');
      assert.ok(
        header === null || header === descriptor.entrypoint,
        'Sandbox raw entrypoint changed.',
      );
    }
    // Only raw readback adopts the already-attested upload identity; multipart stays strict.
    return {
      entrypoint: descriptor.entrypoint,
      filename: descriptor.filename,
      mimeType: descriptor.mimeType,
      bytes,
    };
  }
  const entrypoint = response.headers.get('cf-entrypoint');
  assert.ok(
    entrypoint && entrypoint.trim() && entrypoint !== 'metadata',
    'Sandbox entrypoint unavailable.',
  );
  const entries = [...(await response.formData()).entries()];
  format.partCount = entries.length;
  format.parts = await Promise.all(
    entries.slice(0, 8).map(async ([field, file]) => {
      const isFile = typeof file !== 'string';
      const bytes = Buffer.from(isFile ? await file.arrayBuffer() : file);
      return {
        field: safeName(field),
        filename: isFile ? safeName(file.name) : null,
        mimeType: isFile ? safeMime(file.type) : null,
        isFile,
        size: bytes.length,
        sha256: hash(bytes),
      };
    }),
  );
  format.partsTruncated = entries.length > 8;
  assert.equal(entries.length, 1, 'Expected exactly one sandbox module.');
  const [field, file] = entries[0];
  assert.equal(field, entrypoint, 'Sandbox entrypoint file unavailable.');
  assert.ok(typeof file !== 'string' && file.name, 'Sandbox module file unavailable.');
  assert.ok(
    ['application/javascript+module', 'text/javascript+module'].includes(file.type),
    'Sandbox module must remain JavaScript module syntax.',
  );
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.ok(bytes.length, 'Sandbox module empty.');
  assert.equal(hash(bytes), expectedSha, 'Sandbox module is not the attested code.');
  return { entrypoint, filename: file.name, mimeType: file.type, bytes };
}
