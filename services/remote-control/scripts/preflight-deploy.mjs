import { fileURLToPath } from 'node:url';
import { experimental_readRawConfig } from 'wrangler';

// Use the pinned CLI's actual JSONC parser; comments and trailing commas are valid.
const { rawConfig: config, redirected } = experimental_readRawConfig({
  config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
});
const namespace = config.kv_namespaces?.find((value) => value.binding === 'OAUTH_KV');
if (
  redirected ||
  config.name !== 'kerfdesk-phone-control' ||
  config.account_id !== '10d5d0bdb9bf11ca0468db275a787e20' ||
  config.vars?.PUBLIC_ORIGIN !== 'https://kerfdesk-phone-control.cisgz3a.workers.dev' ||
  namespace?.id !== '55981c23524446d4ac69a04bfba21803' ||
  config.kv_namespaces?.length !== 1 ||
  config.durable_objects?.bindings?.length !== 1 ||
  config.durable_objects?.bindings?.[0]?.name !== 'REMOTE_DEVICES' ||
  config.durable_objects?.bindings?.[0]?.class_name !== 'RemoteDevice' ||
  config.durable_objects?.bindings?.[0]?.script_name ||
  config.migrations?.length !== 1 ||
  config.migrations?.[0]?.tag !== 'v1' ||
  config.migrations?.[0]?.new_sqlite_classes?.join(',') !== 'RemoteDevice' ||
  config.workers_dev !== true ||
  config.preview_urls !== false ||
  config.routes?.length ||
  config.route
) {
  console.error(
    'Deployment refused. Verify the correct account and bind the approved dedicated OAUTH_KV namespace first.',
  );
  process.exitCode = 1;
} else {
  console.log(
    'The fixed relay target and dedicated namespace binding are configured. Confirm provider identity and review before deployment.',
  );
}
