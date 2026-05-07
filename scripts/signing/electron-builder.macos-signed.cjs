const base = require('../../package.json').build;

module.exports = {
  ...base,
  mac: {
    ...base.mac,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'scripts/signing/entitlements.mac.plist',
    entitlementsInherit: 'scripts/signing/entitlements.mac.plist',
    identity: process.env.MAC_SIGNING_IDENTITY || undefined,
    notarize: {
      teamId: process.env.APPLE_TEAM_ID,
    },
  },
};
