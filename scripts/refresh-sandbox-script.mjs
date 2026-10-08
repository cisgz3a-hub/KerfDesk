// Operator-only restoration of one attested sandbox module. Never targets production.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACCOUNT, flagMetadata, guardedSettings } from './apply-payment-settings.mjs';

export const SANDBOX_WORKER = 'kerfdesk-desktop-licensing-sandbox';
export const SANDBOX_ORIGIN = 'https://kerfdesk-desktop-licensing-sandbox.cisgz3a.workers.dev';
export const GOOD_VERSION_PREFIX = '202ea7dc';
export const GOOD_CODE_SHA256 = 'ea76d1d65cccbee7445551da56236dce6cea00a2503f144185093b5b46912907';
const namespace = 'b5b0cb9d97f4404582f884ff2b1a6ba8';
const target = {
  environment: 'sandbox',
  signing: 'sandbox-20260929',
  authority: 'SandboxLicenseAuthority',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};
const fingerprint = (settings) => {
  const protectedFields = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !['annotations', 'exports_reconciliation'].includes(key),
    ),
  );
  protectedFields.bindings = settings.bindings
    .map(canonical)
    .sort((a, b) => a.name.localeCompare(b.name));
  return hash(JSON.stringify(canonical(protectedFields)));
};

export function guardSandboxRefresh(settings) {
  assert.equal(
    guardedSettings(settings, target),
    'false',
    'Sandbox checkout must already be closed.',
  );
  assert.ok(
    settings.bindings.some(
      ({ name, type }) => name === 'ASSETS' && ['service', 'assets'].includes(type),
    ),
    'Existing asset binding unavailable.',
  );
  assert.ok(
    typeof settings.compatibility_date === 'string' && settings.compatibility_date.length,
    'Current compatibility date unavailable.',
  );
  assert.ok(
    Array.isArray(settings.compatibility_flags),
    'Current compatibility flags unavailable.',
  );
}

export function sandboxUploadMetadata(settings, activeVersion, entrypoint, operationTag) {
  guardSandboxRefresh(settings);
  assert.ok(
    typeof entrypoint === 'string' && entrypoint.trim() && entrypoint !== 'metadata',
    'Module entrypoint unavailable.',
  );
  assert.ok(
    typeof operationTag === 'string' &&
      /^kerfdesk-sandbox-refresh-[0-9a-f-]{36}$/u.test(operationTag),
    'Sandbox refresh operation tag unavailable.',
  );
  const metadata = flagMetadata(settings, activeVersion, 'false');
  return {
    ...metadata,
    ...(settings.tags !== undefined ? { tags: settings.tags } : {}),
    main_module: entrypoint,
    keep_assets: true,
    annotations: {
      'workers/tag': operationTag,
      'workers/message':
        'Restore attested sandbox health dispatcher; preserve existing authority and closed checkout',
    },
  };
}

export async function readSandboxModule(response, format = {}) {
  const mimeType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  const safeName = (name) =>
    typeof name === 'string' && /^[A-Za-z0-9_.-]{1,128}$/u.test(name) ? name : null;
  format.contentType = /^[a-z0-9.+-]{1,64}\/[a-z0-9.+-]{1,64}$/u.test(mimeType) ? mimeType : null;
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
    assert.equal(format.raw.sha256, GOOD_CODE_SHA256, 'Sandbox module is not the attested code.');
    // The pin identifies this self-contained ESM bundle; normalize its raw response filename.
    return {
      entrypoint: 'sandbox-worker.js',
      filename: 'sandbox-worker.js',
      mimeType: 'application/javascript+module',
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
        mimeType: isFile ? file.type : null,
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
  assert.equal(hash(bytes), GOOD_CODE_SHA256, 'Sandbox module is not the attested code.');
  return { entrypoint, filename: file.name, mimeType: file.type, bytes };
}

export async function refreshSandboxScript({ operation, token, output }, fetcher = fetch) {
  const base =
    'https://api.cloudflare.com/client/v4/accounts/' +
    ACCOUNT +
    '/workers/scripts/' +
    SANDBOX_WORKER;
  const started = Date.now();
  const operationTag = 'kerfdesk-sandbox-refresh-' + crypto.randomUUID();
  let operationVersion;
  let recovering = false;
  let stage = 'operation-validation';
  let httpStatus = null;
  let originalVersion;
  let sourceVersion;
  let currentVersion;
  let before;
  let initialClosedVerified = false;
  let originalBuy;
  let module;
  let moduleFormatFailure;
  let mutationAttempted = false;
  let uploadResponseReceived = false;
  const setStage = (value) => {
    stage = value;
    httpStatus = null;
  };
  const signal = () => {
    const remaining = started + (recovering ? 240000 : 180000) - Date.now();
    assert.ok(remaining > 0, 'Operator verification time budget exhausted.');
    return AbortSignal.timeout(Math.min(60000, remaining));
  };
  const request = async (suffix, init, label) => {
    setStage(label);
    const response = await fetcher(base + suffix, {
      ...init,
      headers: { Authorization: 'Bearer ' + token, ...init?.headers },
      redirect: 'error',
      signal: signal(),
    });
    httpStatus = response.status;
    assert.ok(response.ok, 'Cloudflare request failed.');
    return response;
  };
  const api = async (suffix, init, label) => {
    const response = await request(suffix, init, label);
    const body = await response.json();
    assert.equal(body.success, true, 'Cloudflare refused sandbox refresh.');
    return body.result;
  };
  const activeVersion = async () => {
    const result = await api('/deployments', {}, 'sandbox-deployments-get');
    const deployments = Array.isArray(result) ? result : result.deployments;
    assert.ok(Array.isArray(deployments) && deployments.length, 'Sandbox deployment unavailable.');
    const latest = [...deployments].sort((a, b) => b.created_on.localeCompare(a.created_on))[0];
    assert.equal(latest.versions?.length, 1, 'Gradual deployment requires separate review.');
    assert.equal(
      latest.versions[0].percentage,
      100,
      'Gradual deployment requires separate review.',
    );
    assert.ok(uuid.test(latest.versions[0].version_id), 'Sandbox active version unavailable.');
    return latest.versions[0].version_id;
  };
  // Wrangler's ApiVersion has top-level annotations, separate from metadata's author/timestamps.
  const verifyOperationVersion = async (active) => {
    const version = await api('/versions/' + active, {}, 'sandbox-operation-version-get');
    setStage('sandbox-operation-ownership-verification');
    assert.equal(version?.id, active, 'Sandbox version metadata disagrees.');
    assert.equal(
      version?.annotations?.['workers/tag'],
      operationTag,
      'Active sandbox deployment is not owned by this refresh.',
    );
    const result = await api(
      '/versions?deployable=true',
      {},
      'sandbox-operation-version-discovery',
    );
    setStage('sandbox-operation-uniqueness-verification');
    assert.ok(Array.isArray(result?.items), 'Sandbox operation version list unavailable.');
    const matches = result.items.filter(
      (item) => item?.annotations?.['workers/tag'] === operationTag,
    );
    assert.equal(matches.length, 1, 'Sandbox refresh operation ownership is ambiguous.');
    assert.equal(matches[0].id, active, 'Sandbox operation tag belongs to another version.');
    if (operationVersion)
      assert.equal(active, operationVersion, 'Sandbox refresh ownership is ambiguous.');
    operationVersion = active;
  };
  const readSettings = () => api('/settings', {}, 'sandbox-settings-get');
  const readModule = async (version, label) => {
    const format = {};
    try {
      return await readSandboxModule(
        await request('/content/v2?version=' + version, {}, label),
        format,
      );
    } catch (error) {
      moduleFormatFailure = { version, stage: label, ...format };
      throw error;
    }
  };
  const publicConfig = async () => {
    setStage('sandbox-public-config-get');
    const response = await fetcher(SANDBOX_ORIGIN + '/v1/public/config', {
      redirect: 'error',
      cache: 'no-store',
      signal: signal(),
    });
    httpStatus = response.status;
    assert.equal(response.status, 200, 'Sandbox public configuration unavailable.');
    const config = await response.json();
    setStage('sandbox-public-config-verification');
    assert.equal(config.enabled, false, 'Sandbox public checkout must remain closed.');
  };
  const buyHtml = async () => {
    setStage('sandbox-buy-html-get');
    const response = await fetcher(SANDBOX_ORIGIN + '/buy.html', {
      redirect: 'error',
      cache: 'no-store',
      signal: signal(),
    });
    httpStatus = response.status;
    assert.equal(response.status, 200, 'Sandbox checkout assets unavailable.');
    assert.equal(
      (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase(),
      'text/html',
      'Sandbox checkout must remain HTML.',
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length, 'Sandbox checkout assets empty.');
    return { sha256: hash(bytes), size: bytes.length };
  };
  const verifyBuy = async () => {
    const value = await buyHtml();
    setStage('sandbox-buy-html-verification');
    assert.deepEqual(value, originalBuy, 'Sandbox checkout assets changed.');
  };
  const health = async () => {
    setStage('sandbox-public-health-get');
    const response = await fetcher(SANDBOX_ORIGIN + '/v1/public/health', {
      redirect: 'error',
      cache: 'no-store',
      signal: signal(),
    });
    httpStatus = response.status;
    assert.equal(response.status, 200, 'Sandbox public authority health unavailable.');
    const body = await response.json();
    setStage('sandbox-public-health-verification');
    assert.equal(body.ok, true, 'Sandbox public authority unhealthy.');
  };
  const verifySettings = async () => {
    const settings = await readSettings();
    setStage('sandbox-protected-settings-verification');
    guardSandboxRefresh(settings);
    assert.equal(fingerprint(settings), fingerprint(before), 'Sandbox protected settings changed.');
  };
  const verifyRestoration = async () => {
    const active = await activeVersion();
    if (mutationAttempted) await verifyOperationVersion(active);
    await verifySettings();
    const restored = await readModule(active, 'sandbox-restored-content-get');
    setStage('sandbox-restored-content-verification');
    assert.equal(restored.entrypoint, module.entrypoint, 'Sandbox entrypoint changed.');
    assert.equal(restored.filename, module.filename, 'Sandbox module filename changed.');
    assert.equal(restored.mimeType, module.mimeType, 'Sandbox module type changed.');
    await publicConfig();
    await verifyBuy();
    await health();
    const boundary = await activeVersion();
    setStage('sandbox-post-verification-version-check');
    assert.equal(boundary, active, 'Sandbox deployment changed during verification.');
    currentVersion = active;
  };
  const fields = () => ({
    checkedAt: new Date().toISOString(),
    account: ACCOUNT,
    worker: SANDBOX_WORKER,
    environment: 'sandbox',
    operation: 'sandbox-refresh-code',
    operationTag,
    operationVersion: operationVersion ?? null,
    sourceVersion: sourceVersion ?? null,
    sourceVersionPrefix: GOOD_VERSION_PREFIX,
    codeSha256: GOOD_CODE_SHA256,
    originalVersion: originalVersion ?? null,
    version: currentVersion ?? null,
    mutationAttempted,
    uploadResponseReceived,
    mutated: uploadResponseReceived ? true : mutationAttempted ? null : false,
    realMoneyTransaction: false,
    productionCalls: false,
  });
  const save = async (receipt) => {
    if (!output) return;
    await mkdir(resolve(output), { recursive: true });
    await writeFile(
      resolve(output, 'sandbox-refresh-receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    );
  };
  const success = async (reconciliation) => {
    const receipt = {
      ...fields(),
      outcome: 'verified',
      flag: 'false',
      codeVerified: true,
      protectedSettingsUnchanged: true,
      authorityNamespace: namespace,
      protectedBindingNames: before.bindings.map(({ name }) => name).sort(),
      publicConfigEnabled: false,
      buyHtmlUnchanged: true,
      buyHtmlSha256: originalBuy.sha256,
      buyHtmlSize: originalBuy.size,
      health: true,
      ...(reconciliation ? { reconciliation } : {}),
    };
    setStage('sandbox-receipt-write');
    await save(receipt);
    return receipt;
  };
  try {
    assert.equal(operation, 'sandbox-refresh-code', 'Only sandbox code refresh is supported.');
    assert.ok(
      typeof token === 'string' && token.length >= 20,
      'Cloudflare credential unavailable.',
    );
    originalVersion = await activeVersion();
    before = await readSettings();
    setStage('sandbox-preflight-settings-verification');
    guardSandboxRefresh(before);
    initialClosedVerified = true;
    await publicConfig();
    originalBuy = await buyHtml();
    const result = await api('/versions?deployable=true', {}, 'sandbox-good-version-discovery');
    assert.ok(Array.isArray(result?.items), 'Sandbox version list unavailable.');
    const candidates = result.items
      .map(({ id }) => id)
      .filter((id) => typeof id === 'string' && id.startsWith(GOOD_VERSION_PREFIX));
    assert.equal(candidates.length, 1, 'Attested sandbox version must resolve uniquely.');
    assert.ok(uuid.test(candidates[0]), 'Attested sandbox version requires a full UUID.');
    sourceVersion = candidates[0];
    module = await readModule(sourceVersion, 'sandbox-attested-content-get');
    const boundary = await activeVersion();
    setStage('sandbox-pre-mutation-version-check');
    assert.equal(boundary, originalVersion, 'Sandbox deployment changed before refresh.');
    await verifySettings();
    const uploadBoundary = await activeVersion();
    setStage('sandbox-final-pre-upload-version-check');
    assert.equal(
      uploadBoundary,
      originalVersion,
      'Sandbox deployment changed after settings read.',
    );
    if (originalVersion !== sourceVersion) {
      const form = new FormData();
      form.set(
        'metadata',
        JSON.stringify(
          sandboxUploadMetadata(before, originalVersion, module.entrypoint, operationTag),
        ),
      );
      form.set(
        module.entrypoint,
        new Blob([module.bytes], { type: module.mimeType }),
        module.filename,
      );
      mutationAttempted = true;
      await api('?bindings_inherit=strict', { method: 'PUT', body: form }, 'sandbox-code-upload');
      uploadResponseReceived = true;
    }
    await verifyRestoration();
    return await success();
  } catch {
    const failure = { stage, httpStatus };
    const recovery = { mode: 'not-needed', rollbackAttempted: false, closedVerified: false };
    if (mutationAttempted) {
      recovering = true;
      // A lost acknowledgement may still have installed exactly the attested closed configuration.
      try {
        await verifyRestoration();
        return await success({ initialFailure: failure, readBackVerified: true });
      } catch {
        recovery.reconciliationFailure = { stage, httpStatus };
      }
      recovery.mode = 'not-restored-unowned-deployment';
      recovery.requestAcknowledged = false;
      let verifyOriginal = false;
      try {
        const active = await activeVersion();
        recovery.observedVersion = active;
        if (active === originalVersion) {
          recovery.mode = 'original-closed-sandbox-deployment-already-active';
          verifyOriginal = true;
        } else {
          // A lost PUT acknowledgement never grants ownership of the active deployment.
          await verifyOperationVersion(active);
          recovery.ownershipVerified = true;
          const boundary = await activeVersion();
          setStage('sandbox-rollback-ownership-boundary-check');
          assert.equal(boundary, active, 'Sandbox deployment changed before rollback.');
          recovery.mode = 'restore-original-closed-sandbox-deployment';
          recovery.rollbackAttempted = true;
          try {
            await api(
              '/deployments',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  strategy: 'percentage',
                  versions: [{ version_id: originalVersion, percentage: 100 }],
                }),
              },
              'sandbox-rollback-deployment',
            );
            recovery.requestAcknowledged = true;
          } catch {
            recovery.requestFailure = { stage, httpStatus };
          }
          verifyOriginal = true;
        }
      } catch {
        recovery.ownershipFailure = { stage, httpStatus };
      }
      if (verifyOriginal) {
        try {
          const active = await activeVersion();
          setStage('sandbox-rollback-version-verification');
          assert.equal(active, originalVersion, 'Sandbox rollback version disagrees.');
          await verifySettings();
          await publicConfig();
          await verifyBuy();
          const boundary = await activeVersion();
          setStage('sandbox-rollback-final-version-check');
          assert.equal(boundary, originalVersion, 'Sandbox deployment changed during recovery.');
          recovery.buyHtmlUnchanged = true;
          recovery.version = active;
          recovery.flag = 'false';
          recovery.closedVerified = true;
          recovery.protectedSettingsUnchanged = true;
        } catch {
          recovery.verificationFailure = { stage, httpStatus };
        }
      }
    }
    const receipt = {
      ...fields(),
      outcome: 'failed',
      flag: recovery.closedVerified
        ? 'false'
        : mutationAttempted
          ? null
          : initialClosedVerified
            ? 'false'
            : null,
      health: false,
      failure,
      recovery,
      ...(moduleFormatFailure ? { moduleFormatFailure } : {}),
    };
    try {
      await save(receipt);
    } catch {
      receipt.evidenceWritten = false;
    }
    const error = new Error('Sandbox refresh failed at ' + failure.stage + '.');
    error.name = 'SandboxRefreshError';
    error.receipt = receipt;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  refreshSandboxScript({
    operation: process.argv[2],
    token: process.env.KERFDESK_PAYMENT_LAUNCH_CF_TOKEN,
    output: process.env.KERFDESK_PAYMENT_FLAG_EVIDENCE,
  })
    .then((receipt) => console.log(JSON.stringify(receipt)))
    .catch((error) => {
      console.error(
        JSON.stringify(
          error.receipt ?? { outcome: 'failed', failure: { stage: 'operation-validation' } },
        ),
      );
      process.exitCode = 1;
    });
}
