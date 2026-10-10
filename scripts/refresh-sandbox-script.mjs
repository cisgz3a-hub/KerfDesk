// Operator-only restoration of one attested sandbox module. Never targets production.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACCOUNT } from './apply-payment-settings.mjs';
import { guardSandboxRefresh, sandboxUploadForm } from './sandbox-restoration-metadata.mjs';
export { guardSandboxRefresh, sandboxUploadMetadata } from './sandbox-restoration-metadata.mjs';
import { readRetainedSandboxBundle } from './retained-sandbox-bundle.mjs';
import {
  attestSandboxVersion,
  readAttestedSandboxModule,
  sandboxReceiptBindingName,
  sandboxSettingsFingerprint as fingerprint,
} from './sandbox-restoration-guards.mjs';
import { readCloudflareFailure } from './cloudflare-error-diagnostics.mjs';
import { readSandboxVersionContent } from './sandbox-version-content.mjs';
import {
  captureUnfilteredPage,
  pinLatestOriginal,
  requireUnchangedPreuploadPage,
  attestAcknowledgedCandidate,
} from './sandbox-latest-inheritance.mjs';

export const SANDBOX_WORKER = 'kerfdesk-desktop-licensing-sandbox';
export const SANDBOX_ORIGIN = 'https://kerfdesk-desktop-licensing-sandbox.cisgz3a.workers.dev';
export const GOOD_VERSION_PREFIX = '202ea7dc';
export const GOOD_CODE_SHA256 = 'ea76d1d65cccbee7445551da56236dce6cea00a2503f144185093b5b46912907';
const namespace = 'b5b0cb9d97f4404582f884ff2b1a6ba8';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const readSandboxModule = (response, format, expectedRawDescriptor) =>
  readAttestedSandboxModule(response, GOOD_CODE_SHA256, format, expectedRawDescriptor);

export async function refreshSandboxScript(
  { operation, token, output, retainedBundle },
  fetcher = fetch,
) {
  const base =
    'https://api.cloudflare.com/client/v4/accounts/' +
    ACCOUNT +
    '/workers/scripts/' +
    SANDBOX_WORKER;
  const versionBase = base.replace('/workers/scripts/', '/workers/workers/') + '/versions';
  const started = Date.now();
  const operationTag = 'kerfdesk-sandbox-refresh-' + crypto.randomUUID();
  let operationVersion;
  let recovering = false;
  let stage = 'operation-validation';
  let httpStatus = null;
  let originalVersion;
  let sourceVersion;
  const sourceKind =
    retainedBundle === undefined ? 'historical-version' : 'retained-attested-bundle';
  let currentVersion;
  let before;
  let beforeVersionResources;
  let beforeVersionInfo;
  let inheritancePin;
  let inheritanceEvidence;
  let versionResourceFailure;
  let stagedVersionVerified = false;
  let deploymentAttempted = false;
  let deploymentResponseReceived = false;
  let initialClosedVerified = false;
  let originalBuy;
  let module;
  let moduleFormatFailure;
  let apiFailure;
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
  const request = async (suffix, init, label, apiBase = base) => {
    setStage(label);
    const response = await fetcher(apiBase + suffix, {
      ...init,
      headers: { Authorization: 'Bearer ' + token, ...init?.headers },
      redirect: 'error',
      signal: signal(),
    });
    httpStatus = response.status;
    if (!response.ok && !apiFailure) {
      const diagnostic = await readCloudflareFailure(response, init?.body);
      apiFailure = { stage: label, httpStatus: response.status, ...diagnostic };
    }
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
    return version;
  };
  const attestResources = (info, expected, label) => {
    const diagnostic = {};
    setStage(label);
    try {
      return attestSandboxVersion(info, expected, before, diagnostic, beforeVersionResources);
    } catch (error) {
      versionResourceFailure ??= { stage: label, ...diagnostic };
      throw error;
    }
  };
  const readVersionResources = async (version, label) =>
    attestResources(await api('/versions/' + version, {}, label + '-get'), version, label);
  const latestPage = async (label) => {
    const requestedPath = '/versions';
    const result = await api(requestedPath, {}, label + '-get');
    setStage(label);
    return captureUnfilteredPage({ requestedPath, result });
  };
  const verifyCandidateInheritance = async (label) => {
    const afterPage = await latestPage(label);
    const candidateInfo = await api('/versions/' + operationVersion, {}, label + '-detail-get');
    const active = await activeVersion();
    setStage(label);
    inheritanceEvidence = {
      ...attestAcknowledgedCandidate({
        pin: inheritancePin,
        afterPage,
        uploadAcknowledged: uploadResponseReceived,
        uploadId: operationVersion,
        candidateInfo,
        activeVersion: active,
      }),
      lastVerifiedStage: label,
    };
  };
  const verifyCandidate = async () => {
    const info = await verifyOperationVersion(operationVersion);
    attestResources(info, operationVersion, 'sandbox-staged-resource-verification');
    const restored = await readModule(operationVersion, 'sandbox-staged-content-get', {
      entrypoint: module.entrypoint,
      filename: module.filename,
      mimeType: module.mimeType,
    });
    setStage('sandbox-staged-content-verification');
    for (const key of ['entrypoint', 'filename', 'mimeType'])
      assert.equal(restored[key], module[key], 'Sandbox staged module identity changed.');
    // Lost-ack discovery can attest resources for the receipt, never qualify activation.
    stagedVersionVerified =
      uploadResponseReceived && inheritanceEvidence?.inferredProvenance === true;
  };
  const readSettings = () => api('/settings', {}, 'sandbox-settings-get');
  const readModule = async (version, label, expectedRawDescriptor) => {
    const format = {};
    try {
      return await readSandboxVersionContent(
        await request('/' + version + '?include=modules', {}, label, versionBase),
        version,
        GOOD_CODE_SHA256,
        format,
        expectedRawDescriptor,
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
    if (deploymentAttempted) await verifyOperationVersion(active);
    await verifySettings();
    await readVersionResources(active, 'sandbox-restored-resource-verification');
    const restored = await readModule(active, 'sandbox-restored-content-get', {
      entrypoint: module.entrypoint,
      filename: module.filename,
      mimeType: module.mimeType,
    });
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
    sourceKind,
    sourceVersion: sourceVersion ?? null,
    sourceVersionPrefix: retainedBundle === undefined ? GOOD_VERSION_PREFIX : null,
    codeSha256: GOOD_CODE_SHA256,
    originalVersion: originalVersion ?? null,
    version: currentVersion ?? null,
    mutationAttempted,
    uploadResponseReceived,
    inheritance: {
      mode: 'guarded-latest',
      inferredProvenance: false,
      atomicSourcePin: false,
      opaqueSecretEqualityProven: false,
      ...(inheritanceEvidence ?? {}),
    },
    stagingAttempted: mutationAttempted,
    stagedVersion: operationVersion ?? null,
    stagedVersionVerified,
    deploymentAttempted,
    deploymentResponseReceived,
    mutated: deploymentResponseReceived ? true : deploymentAttempted ? null : false,
    realMoneyTransaction: false,
    productionCalls: false,
    ...(apiFailure ? { apiFailure } : {}),
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
      protectedBindingNames: before.bindings
        .map(({ name }) => sandboxReceiptBindingName(name))
        .filter(Boolean)
        .sort(),
      protectedBindingNamesRedacted: before.bindings.some(
        ({ name }) => sandboxReceiptBindingName(name) === null,
      ),
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
    if (retainedBundle !== undefined) {
      setStage('sandbox-retained-bundle-verification');
      module = readRetainedSandboxBundle(retainedBundle, GOOD_CODE_SHA256);
    }
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
    beforeVersionInfo = await api(
      '/versions/' + originalVersion,
      {},
      'sandbox-original-resource-verification-get',
    );
    beforeVersionResources = attestResources(
      beforeVersionInfo,
      originalVersion,
      'sandbox-original-resource-verification',
    );
    if (retainedBundle === undefined) {
      const result = await api('/versions?deployable=true', {}, 'sandbox-good-version-discovery');
      assert.ok(Array.isArray(result?.items), 'Sandbox version list unavailable.');
      const candidates = result.items
        .map(({ id }) => id)
        .filter((id) => typeof id === 'string' && id.startsWith(GOOD_VERSION_PREFIX));
      assert.equal(candidates.length, 1, 'Attested sandbox version must resolve uniquely.');
      assert.ok(uuid.test(candidates[0]), 'Attested sandbox version requires a full UUID.');
      sourceVersion = candidates[0];
      module = await readModule(sourceVersion, 'sandbox-attested-content-get');
    }
    if (originalVersion !== sourceVersion) {
      const page = await latestPage('sandbox-inheritance-baseline-verification');
      inheritancePin = pinLatestOriginal(page, originalVersion, beforeVersionInfo, operationTag);
    }
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
      const form = sandboxUploadForm(before, originalVersion, module, operationTag);
      const preuploadPage = await latestPage('sandbox-inheritance-pre-upload-verification');
      requireUnchangedPreuploadPage(inheritancePin, preuploadPage);
      const latestBoundary = await activeVersion();
      setStage('sandbox-final-pre-upload-version-check');
      assert.equal(latestBoundary, originalVersion, 'Sandbox deployment changed before upload.');
      mutationAttempted = true;
      const uploaded = await api(
        '/versions?bindings_inherit=strict',
        { method: 'POST', body: form },
        'sandbox-code-upload',
      );
      uploadResponseReceived = true;
      setStage('sandbox-staged-version-identity');
      assert.ok(uuid.test(uploaded?.id), 'Sandbox staged version unavailable.');
      operationVersion = uploaded.id;
      await verifyCandidateInheritance('sandbox-inheritance-staged-verification');
      await verifyCandidate();
      await verifySettings();
      const activationBoundary = await activeVersion();
      setStage('sandbox-activation-boundary-check');
      assert.equal(
        activationBoundary,
        originalVersion,
        'Sandbox deployment changed before activation.',
      );
      await verifySettings();
      await verifyCandidateInheritance('sandbox-inheritance-pre-activation-verification');
      const finalBoundary = await activeVersion();
      setStage('sandbox-final-pre-deployment-version-check');
      assert.equal(
        finalBoundary,
        originalVersion,
        'Sandbox deployment changed after settings read.',
      );
      deploymentAttempted = true;
      await api(
        '/deployments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strategy: 'percentage',
            versions: [{ version_id: operationVersion, percentage: 100 }],
          }),
        },
        'sandbox-staged-deployment',
      );
      deploymentResponseReceived = true;
    }
    await verifyRestoration();
    return await success();
  } catch {
    const failure = { stage, httpStatus };
    const recovery = { mode: 'not-needed', rollbackAttempted: false, closedVerified: false };
    if (mutationAttempted) {
      recovering = true;
      // Only an attempted activation can have changed the active deployment.
      if (deploymentAttempted) {
        try {
          await verifyRestoration();
          return await success({ initialFailure: failure, readBackVerified: true });
        } catch {
          recovery.reconciliationFailure = { stage, httpStatus };
        }
      } else if (!uploadResponseReceived) {
        // Discover an ambiguous staged upload for evidence, never automatically activate it.
        try {
          const result = await api('/versions?deployable=true', {}, 'sandbox-staging-discovery');
          const matches = result?.items?.filter(
            (item) => item?.annotations?.['workers/tag'] === operationTag,
          );
          setStage('sandbox-staging-discovery-verification');
          assert.equal(matches?.length, 1, 'Sandbox staged upload unavailable or ambiguous.');
          assert.ok(uuid.test(matches[0].id), 'Sandbox staged UUID unavailable.');
          operationVersion = matches[0].id;
          await verifyCandidate();
          recovery.stagingReadBackVerified = true;
        } catch {
          recovery.stagingVerificationFailure = { stage, httpStatus };
        }
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
          assert.ok(deploymentAttempted, 'This operation never attempted activation.');
          // Only this operation's uniquely owned activated version permits rollback.
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
      ...(versionResourceFailure ? { versionResourceFailure } : {}),
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
    retainedBundle: process.env.KERFDESK_PAYMENT_SANDBOX_ATTESTED_BUNDLE || undefined,
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
