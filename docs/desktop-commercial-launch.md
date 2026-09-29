# KerfDesk commercial desktop launch

This implementation is prepared for review. No commercial installer, paid
checkout, live licensing service or developer licence has been published by this
change. Existing web and free/Preview app builds continue to work without activation.

## Approved offer

| Item | Terms |
| --- | --- |
| Trial | Full features, 30 days from first server registration |
| Purchase | USD49.50, perpetual use of eligible versions, three active computers, one year of updates |
| Renewal | Optional USD20 for another year; no recurring subscription |
| Johann and Father | Two individual free developer keys, three computers each, unlimited updates |

Paddle-added taxes are additional. Expired update coverage never ends paid use of
an already eligible version. The licence controls entry into a new commercial app
session; it cannot stop an active machining session. Keep normal Frame, review,
Abort and controller workflows intact.

## Provider preparation

1. Confirm the Cloudflare account that owns `kerfdesk.com`. The existing default
   Wrangler login was a different account. Do not deploy into an account selected
   only because a login succeeded. Verify the domain, Pages project and account ID.
2. Create the licensing Worker from `services/desktop-licensing/wrangler.jsonc`,
   using its README for the exact secrets and durable bindings. Bind
   `license.kerfdesk.com` only after the target account is confirmed. Initial
   licensing and payment flags are disabled. Keep the SQLite authority and its
   signing/HMAC secrets backed up together.
3. Provision `kerfdesk-downloads` and `dl.kerfdesk.com` with the CORS/cache contract
   in `desktop-preview-distribution.md`. R2 billing activation and any plan upgrade
   are external account decisions; source tests do not establish that they exist.
4. Complete Paddle seller and payout verification for the South African business.
   Create the fixed one-time USD purchase and renewal catalog, approve
   `https://kerfdesk.com/buy.html`, configure the signed webhook and run complete
   sandbox purchase/claim, renewal, duplicate-delivery and interrupted-checkout
   scenarios. Set live credentials only after these pass. Never put private API or
   webhook keys in the browser or app package.
5. Finalize seller identity, customer terms, privacy, refunds/chargebacks and support
   recovery before accepting money. Retain the existing MIT and third-party rights;
   private source visibility does not revoke earlier grants. Supply the reviewed
   commercial installer terms explicitly during package preparation.

Authentication for the Codex Cloudflare MCP connections is separate from Wrangler
and GitHub Actions. Installing those connections does not prove deployment access
or provision any resources. Cloudflare's official skills and five MCP connections
were registered locally; account OAuth still needs the owner's approval.

## Keys and distribution

Public anchors are in `public/desktop-release-keys.json` and
`public/desktop-licence-keys.json`. Private signing keys and the administration,
derivation and hashing secrets belong only in protected operator storage/provider
secrets. Back them up securely; losing them can strand licence issuance or release
verification. Do not regenerate them casually between builds.

Commercial package metadata pins the licensing endpoint, entitlement keys and
stable release keys. Its signed prebuild release identity contains the exact
version, source SHA/ref and release date, with no circular hash of the installer.
Postbuild update manifests additionally bind the actual installer, blockmap and
feed hashes. Preserve that same release identity on a retry.

Windows release signing still needs a purchased/approved certificate or signing
service and a verified publisher identity. A publisher's Ed25519 metadata signature
does not replace Authenticode. The commercial builder fails without code signing.
Existing unsigned Preview tools remain suitable for preview qualification only.
macOS commercial signing/notarization and signed update qualification remain a
separate launch prerequisite; no macOS auto-update claim is made here.

The commercial feed is separate from `/desktop` and `/desktop/previews`. Keep old
eligible commercial versions available for customers whose update period ended.
The catalog is bounded; reaching its capacity requires a reviewed archival/index
design, not silently evicting old entitlements' last eligible download.

## Pilot verification

After the service is live and its public keys match the package, privately issue
the idempotent `johann` and `father` developer grants described in the service
README. Store their actual licence keys privately and deliver each only to its
owner. Their names are not activation codes. No universal development bypass ships.

On disposable user profiles, install the signed commercial build, start a trial,
restart offline, activate a developer licence, exercise the three-seat limit and
transfer, and verify expired trials and expired update periods separately. Confirm
the app opens as Free with no licence and that only Pro tools ask for one
(ADR-540). Open and save projects, and verify the normal active-job close handoff
with a simulator. Do not operate hardware without
an explicit request.

Publish two genuinely signed test versions through the commercial publisher, then
prove an eligible update downloads and installs on natural quit while an
ineligible release is skipped. Verify installer publisher, hashes, installed
version, retained projects/settings, and public download/CORS/cache behaviour.
Record the exact source, artifact and hosted identity. Only then enable customer
checkout and advertise automatic commercial updates.

The same change that enables checkout sets `UNLICENSED_BUILDS_RUN_FREE = true` in
`src/ui/licensing/edition-policy.ts` (ADR-544). From that deploy, the web app and
the free Preview builds run KerfDesk Free and send Pro tools to the desktop app.
Before merging it, confirm the owner's own machines run the commercial build with
a developer licence, since the free builds stop offering Pro to him too. On the
signed commercial build, confirm that starting KerfDesk with
`--remote-debugging-port=9222` shows the refusal and opens no window.
