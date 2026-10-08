import assert from 'node:assert/strict';

export const originalVersion = '11111111-1111-4111-8111-111111111111';
export const nextVersion = '22222222-2222-4222-8222-222222222222';
export const unrelatedVersion = '33333333-3333-4333-8333-333333333333';
export const target = {
  environment: 'live',
  signing: 'entitlement-2026-09',
  authority: 'LicenseAuthority',
};
export const settings = () => ({
  compatibility_date: '2026-09-28',
  compatibility_flags: [],
  observability: { enabled: true },
  bindings: [
    ...Object.entries({
      LICENSING_ENABLED: 'true',
      PAYMENTS_ENABLED: 'false',
      PADDLE_ENVIRONMENT: 'live',
      SIGNING_KEY_ID: 'entitlement-2026-09',
      PADDLE_PURCHASE_PRICE_ID: 'pri_01m4ajbzk3nx9km7ejhze8hzad',
      PADDLE_RENEWAL_PRICE_ID: 'pri_01m4ajpg52ch0cq8qh15vveq21',
      PADDLE_CHECKOUT_URL: 'https://kerfdesk.com/buy.html',
    }).map(([name, text]) => ({ name, type: 'plain_text', text })),
    ...[
      'SIGNING_PRIVATE_JWK',
      'ADMIN_TOKEN',
      'HASH_SECRET',
      'DERIVATION_SECRET',
      'PADDLE_API_KEY',
      'PADDLE_CLIENT_TOKEN',
      'PADDLE_WEBHOOK_SECRET',
    ].map((name) => ({ name, type: 'secret_text' })),
    {
      name: 'LICENSE_AUTHORITY',
      type: 'durable_object_namespace',
      class_name: 'LicenseAuthority',
      namespace_id: '12345678901234567890123456789012',
    },
    ...['REQUEST_RATE_LIMITER', 'WEBHOOK_RATE_LIMITER', 'TRIAL_RATE_LIMITER'].map((name) => ({
      name,
      type: 'ratelimit',
      namespace_id: '1001',
      simple: { limit: 30, period: 60 },
    })),
  ],
});
const ok = (result) => Response.json({ success: true, result });
export function harness({
  alterProtected = false,
  alterNestedLimit = false,
  reorderNested = false,
  badHealth = false,
  initialFlag = 'false',
  losePatchResponse = false,
  refusePatch = false,
  loseRollbackResponse = false,
  changeVersionAtBoundary = false,
  inspectHttpFailure = false,
  concurrentAfterPatch = false,
  concurrentAfterHealth = false,
  concurrentAtOwnershipBoundary = false,
  originalClosedAfterLostPatch = false,
  missingOperationAnnotation = false,
  nestedOperationAnnotation = false,
  wrongVersionMetadataId = false,
  duplicateOperationTag = false,
  versionListFailure = false,
  unavailableRecoveryDeployment = false,
  afterPatch,
  afterVersionList,
  contentResponse,
} = {}) {
  let value = settings();
  value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text = initialFlag;
  const original = structuredClone(value);
  let version = originalVersion;
  let deploymentReads = 0;
  let contentReads = 0;
  let operationTag;
  const mutations = [];
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url.includes('api.cloudflare.com')) {
      if (url.endsWith('/settings') && init.method === 'PATCH') {
        const payload = JSON.parse(await init.body.get('settings').text());
        mutations.push(payload);
        operationTag = payload.annotations?.['workers/tag'];
        assert.match(operationTag, /^payment-flag-[0-9a-f-]{36}$/u);
        assert.ok(
          payload.bindings
            .filter(({ name }) => name !== 'PAYMENTS_ENABLED')
            .every(({ type, version_id }) => type === 'inherit' && version_id === originalVersion),
        );
        if (refusePatch)
          return new Response('private-token-for-test-only provider body', { status: 403 });
        const flag = payload.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text;
        value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text = flag;
        if (alterProtected)
          value.bindings.find(({ name }) => name === 'SIGNING_KEY_ID').text = 'wrong-signing-key';
        if (alterNestedLimit)
          value.bindings.find(({ name }) => name === 'REQUEST_RATE_LIMITER').simple.limit = 9999;
        if (reorderNested) {
          const limit = value.bindings.find(({ name }) => name === 'REQUEST_RATE_LIMITER');
          limit.simple = { period: limit.simple.period, limit: limit.simple.limit };
        }
        version = nextVersion;
        if (concurrentAfterPatch) version = unrelatedVersion;
        if (originalClosedAfterLostPatch) {
          version = originalVersion;
          value = structuredClone(original);
        }
        afterPatch?.();
        if (losePatchResponse) throw new Error('Network lost with private-token-for-test-only');
        return ok(value);
      }
      if (url.endsWith('/settings'))
        return inspectHttpFailure
          ? new Response('private-token-for-test-only provider body', { status: 403 })
          : ok(value);
      if (url.includes('/versions/')) {
        const requested = url.slice(url.lastIndexOf('/') + 1);
        if (requested === nextVersion) {
          const annotation = { 'workers/tag': operationTag };
          return ok({
            id: wrongVersionMetadataId ? unrelatedVersion : nextVersion,
            metadata: nestedOperationAnnotation ? { annotations: annotation } : {},
            ...(!missingOperationAnnotation && !nestedOperationAnnotation
              ? { annotations: annotation }
              : {}),
          });
        }
        assert.ok([originalVersion, unrelatedVersion].includes(requested));
        return ok({ id: requested, annotations: { 'workers/tag': 'another-operation' } });
      }
      if (url.endsWith('/versions?deployable=true')) {
        if (versionListFailure)
          return new Response('private-token-for-test-only provider body', { status: 403 });
        const items = [
          { id: originalVersion, annotations: { 'workers/tag': 'original-operation' } },
          { id: nextVersion, annotations: { 'workers/tag': operationTag } },
        ];
        if (duplicateOperationTag)
          items.push({ id: unrelatedVersion, annotations: { 'workers/tag': operationTag } });
        if (concurrentAtOwnershipBoundary) {
          version = unrelatedVersion;
          value = structuredClone(original);
        }
        afterVersionList?.();
        return ok({ items });
      }
      if (url.endsWith('/deployments') && init.method === 'POST') {
        const payload = JSON.parse(init.body);
        mutations.push(payload);
        assert.deepEqual(payload.versions, [{ version_id: originalVersion, percentage: 100 }]);
        version = originalVersion;
        value = structuredClone(original);
        if (loseRollbackResponse) throw new Error('Lost rollback with private-token-for-test-only');
        return ok({ id: 'rolled-back' });
      }
      if (url.endsWith('/deployments')) {
        deploymentReads += 1;
        if (unavailableRecoveryDeployment && deploymentReads === 3)
          return new Response('private-token-for-test-only provider body', { status: 403 });
        if (changeVersionAtBoundary && deploymentReads === 2) version = nextVersion;
        return ok({
          deployments: [
            {
              created_on: '2026-10-07T00:00:00Z',
              versions: [{ version_id: version, percentage: 100 }],
            },
          ],
        });
      }
      if (url.endsWith('/content/v2')) {
        contentReads += 1;
        return contentResponse
          ? contentResponse({ version, read: contentReads })
          : new Response('export default { fetch() { return new Response("ok"); } };', {
              headers: { 'Content-Type': 'application/javascript' },
            });
      }
    }
    if (url === 'https://license.kerfdesk.com/v1/public/config') {
      const enabled =
        value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text === 'true';
      return Response.json({
        enabled,
        provider: enabled ? 'paddle' : null,
        environment: enabled ? 'live' : null,
        purchase: { amount: 4950, currency: 'USD' },
        renewal: { amount: 2000, currency: 'USD' },
        clientToken: enabled ? 'public-client-token' : null,
      });
    }
    if (url === 'https://license.kerfdesk.com/v1/public/health') {
      if (concurrentAfterHealth && version === nextVersion) {
        version = unrelatedVersion;
        value = structuredClone(original);
      }
      return Response.json({ ok: !badHealth }, { status: badHealth ? 503 : 200 });
    }
    throw new Error('Unexpected external destination.');
  };
  return {
    fetcher,
    mutations,
    calls,
    currentVersion: () => version,
    currentFlag: () => value.bindings.find(({ name }) => name === 'PAYMENTS_ENABLED').text,
  };
}
