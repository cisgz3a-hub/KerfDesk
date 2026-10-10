// Sandbox-only closed-checkout validation and upload metadata.
import assert from 'node:assert/strict';
import { flagMetadata, guardedSettings } from './apply-payment-settings.mjs';
import { sandboxUploadSettings } from './sandbox-restoration-guards.mjs';

const target = {
  environment: 'sandbox',
  signing: 'sandbox-20260929',
  authority: 'SandboxLicenseAuthority',
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
  const metadata = flagMetadata(sandboxUploadSettings(settings), activeVersion, 'false');
  return {
    ...metadata,
    // Standard script uploads accept only latest. The Sandbox-only caller checks
    // latest against the original before upload and candidate provenance before activation.
    bindings: metadata.bindings.map((binding) =>
      binding.type === 'inherit' ? { ...binding, version_id: 'latest' } : binding,
    ),
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

export function sandboxUploadForm(settings, activeVersion, module, operationTag) {
  const form = new FormData();
  form.set(
    'metadata',
    JSON.stringify(sandboxUploadMetadata(settings, activeVersion, module.entrypoint, operationTag)),
  );
  form.set(module.entrypoint, new Blob([module.bytes], { type: module.mimeType }), module.filename);
  return form;
}
