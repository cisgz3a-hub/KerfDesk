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
    Object.entries(sandboxConfiguredSettings(settings)).filter(
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
const placementFields = ['mode', 'hint', 'region', 'host', 'hostname', 'target'];
const analysisFields = ['status', 'last_analyzed_at'];
const targetFields = ['region', 'host', 'hostname'];
const has = (value, field) => Object.hasOwn(value, field);
const targetString = (value) => typeof value === 'string' && value.length > 0;
const modeEnum = (value) => (['off', 'smart', 'targeted'].includes(value) ? value : null);
const type = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

// Script metadata documents these analysis fields; they are not upload configuration.
// Unknown configuration is refused, even when both responses contain the same shape.
export function sandboxConfiguredPlacement(value, legacyMode) {
  const fail = 'Sandbox placement configuration unavailable.';
  // Wrangler's version-copy path prefers modern placement; placement_mode is a fallback.
  if (value == null) {
    if (legacyMode === 'smart') return { mode: 'smart' };
    assert.ok(legacyMode === undefined || legacyMode === 'off', fail);
    return undefined;
  }
  assert.ok(object(value), fail);
  // The settings endpoint also represents disabled placement as an empty object.
  // Do not infer this from analysis-only data or a conflicting legacy mode.
  if (Object.keys(value).length === 0) {
    assert.ok(legacyMode === undefined || legacyMode === 'off', fail);
    return undefined;
  }
  const configuration = Object.fromEntries(
    Object.entries(value).filter(([key]) => !analysisFields.includes(key)),
  );
  const keys = Object.keys(configuration);
  assert.ok(keys.length > 0 && keys.every((key) => placementFields.includes(key)), fail);
  if (configuration.mode === 'off') {
    assert.deepEqual(keys, ['mode'], fail);
    return undefined;
  }
  if (configuration.mode === 'smart') {
    assert.ok(
      keys.every((key) => ['mode', 'hint'].includes(key)) &&
        (!has(configuration, 'hint') || typeof configuration.hint === 'string'),
      fail,
    );
    return configuration;
  }
  assert.ok(
    (!has(configuration, 'mode') || configuration.mode === 'targeted') &&
      !has(configuration, 'hint'),
    fail,
  );
  const targets = [...targetFields, 'target'].filter((key) => has(configuration, key));
  assert.equal(targets.length, 1, fail);
  if (targets[0] === 'target') {
    const target = configuration.target;
    assert.ok(Array.isArray(target) && target.length === 1 && object(target[0]), fail);
    const fields = Object.keys(target[0]);
    assert.ok(
      configuration.mode === 'targeted' &&
        fields.length === 1 &&
        targetFields.includes(fields[0]) &&
        targetString(target[0][fields[0]]),
      fail,
    );
    return { mode: 'targeted', target: [{ [fields[0]]: target[0][fields[0]] }] };
  }
  assert.ok(targetString(configuration[targets[0]]), fail);
  return { mode: 'targeted', target: [{ [targets[0]]: configuration[targets[0]] }] };
}

export function sandboxConfiguredSettings(settings) {
  return { ...settings, placement: sandboxConfiguredPlacement(settings.placement) };
}

// Wrangler's upload CfPlacement wire form is mode plus one direct target field.
export function sandboxUploadSettings(settings) {
  const configured = sandboxConfiguredSettings(settings);
  const placement = configured.placement;
  return {
    ...configured,
    placement:
      placement?.mode === 'targeted' ? { mode: 'targeted', ...placement.target[0] } : placement,
  };
}

const configuredField = (placement, field) =>
  targetFields.includes(field) ? placement?.target?.[0]?.[field] : placement?.[field];

function placementShape(value, fields = [...placementFields, ...analysisFields]) {
  const result = { type: type(value) };
  if (!object(value)) return result;
  result.fields = fields
    .filter((field) => has(value, field))
    .map((field) => ({
      name: field,
      type: type(value[field]),
      ...(field === 'mode' ? { value: modeEnum(value[field]) } : {}),
      ...(field === 'status'
        ? {
            value: ['SUCCESS', 'UNSUPPORTED_APPLICATION', 'INSUFFICIENT_INVOCATIONS'].includes(
              value[field],
            )
              ? value[field]
              : null,
          }
        : {}),
    }));
  result.unknownFields = Object.keys(value).some((field) => !fields.includes(field));
  if (fields.includes('target') && Array.isArray(value.target)) {
    result.targetCount = value.target.length;
    result.targets = value.target.slice(0, 1).map((entry) => placementShape(entry, targetFields));
  }
  return result;
}

function configuredPlacement(value, legacyMode) {
  try {
    return { valid: true, value: sandboxConfiguredPlacement(value, legacyMode) };
  } catch {
    return { valid: false };
  }
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
      const expectedPlacement = configuredPlacement(settings.placement);
      const observedPlacement = configuredPlacement(script.placement, script.placement_mode);
      const placementsValid = expectedPlacement.valid && observedPlacement.valid;
      diagnostic.placement = {
        settings: { ...placementShape(settings.placement), valid: expectedPlacement.valid },
        script: { ...placementShape(script.placement), valid: observedPlacement.valid },
        legacyMode: { type: type(script.placement_mode), value: modeEnum(script.placement_mode) },
        fieldsEqual: Object.fromEntries(
          placementFields.map((field) => [
            field,
            placementsValid &&
              equal(
                configuredField(expectedPlacement.value, field),
                configuredField(observedPlacement.value, field),
              ),
          ]),
        ),
      };
      valuesEqual.placement =
        placementsValid && equal(observedPlacement.value, expectedPlacement.value);
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
        placement: observedPlacement.value,
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
