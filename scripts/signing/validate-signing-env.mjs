#!/usr/bin/env node
/**
 * T3-4: pre-build validator for the code-signing environment.
 *
 * The signed-builder configs in scripts/signing/electron-builder.{windows,macos}-signed.cjs
 * already wire signtool / Apple notarization into electron-builder, but
 * none of that fires unless the right env vars are set: a Windows EV
 * cert + password, or an Apple Developer ID + notarization credentials.
 *
 * Without this validator a missing cert silently produces an unsigned
 * installer (electron-builder logs a warning; the failure surfaces only
 * later when the user double-clicks the installer and SmartScreen blocks
 * it). Running this script first turns "Why is my installer still
 * unsigned?" into a clear up-front error naming the missing variable.
 *
 * Usage:
 *   node scripts/signing/validate-signing-env.mjs --platform=win
 *   node scripts/signing/validate-signing-env.mjs --platform=mac
 *
 * Exit code 0 = ready to sign. Exit code 1 = at least one required
 * env var missing or empty.
 */
import process from 'node:process';

const args = new Map(
  process.argv
    .slice(2)
    .filter(arg => arg.startsWith('--'))
    .map(arg => {
      const [k, ...v] = arg.replace(/^--/, '').split('=');
      return [k, v.join('=') || 'true'];
    }),
);

const platform = args.get('platform');
if (platform !== 'win' && platform !== 'mac') {
  console.error('[T3-4] usage: validate-signing-env.mjs --platform=win|mac');
  process.exit(2);
}

/**
 * Required env vars per platform. Each entry: { name, why }.
 *
 * Windows uses electron-builder's standard CSC_LINK / CSC_KEY_PASSWORD
 * (which read the cert file/URL + password) plus an explicit
 * publisherName that must match the cert's CN. The Windows-specific
 * WIN_CSC_* variants take precedence if both are set; we accept either.
 *
 * macOS uses MAC_SIGNING_IDENTITY (the Developer ID Application
 * certificate's CN, e.g. "Developer ID Application: LaserForge Inc.
 * (TEAMID)") plus the three notarization credentials. Apple has
 * deprecated `altool` notarization in favor of notarytool; both
 * work via electron-builder, but we require the notarytool-friendly
 * credential triple (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
 * APPLE_TEAM_ID).
 */
const requiredVars = {
  win: [
    {
      names: ['WIN_CSC_LINK', 'CSC_LINK'],
      why: 'path or URL to the EV code-signing certificate (.pfx). Set to the absolute file path or a https URL.',
    },
    {
      names: ['WIN_CSC_KEY_PASSWORD', 'CSC_KEY_PASSWORD'],
      why: 'password for the EV certificate file (do NOT commit; pass via CI secret manager).',
    },
  ],
  mac: [
    {
      names: ['MAC_SIGNING_IDENTITY'],
      why: 'CN of the Developer ID Application certificate, e.g. "Developer ID Application: LaserForge Inc. (TEAMID)".',
    },
    {
      names: ['APPLE_ID'],
      why: 'Apple ID email associated with the Developer Program account that owns the cert.',
    },
    {
      names: ['APPLE_APP_SPECIFIC_PASSWORD'],
      why: 'app-specific password generated at https://appleid.apple.com (Sign-In and Security → App-Specific Passwords).',
    },
    {
      names: ['APPLE_TEAM_ID'],
      why: '10-character Team ID from the Apple Developer account; required for notarytool.',
    },
  ],
};

function isSet(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

const missing = [];
for (const requirement of requiredVars[platform]) {
  if (!requirement.names.some(isSet)) {
    missing.push(requirement);
  }
}

if (missing.length === 0) {
  console.log(`[T3-4] ${platform} signing env validated; ready to sign.`);
  process.exit(0);
}

console.error(`[T3-4] cannot sign ${platform} installer: ${missing.length} required env var(s) missing.\n`);
for (const requirement of missing) {
  const oneOf = requirement.names.length > 1
    ? `one of: ${requirement.names.join(', ')}`
    : requirement.names[0];
  console.error(`  - ${oneOf}`);
  console.error(`      ${requirement.why}`);
}
console.error('\nSee docs/CODE-SIGNING.md for cert provisioning + per-CI-platform setup.');
process.exit(1);
