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
   signing/HMAC secrets backed up together. Service changes take effect only when
   the Worker is redeployed from the owner's PC; before the first redeploy with
   the webhook and trial limits, check that rate-limit namespace IDs `1002` and
   `1003` are not already used by another binding in the account.
3. Provision `kerfdesk-downloads` and `dl.kerfdesk.com` with the CORS/cache contract
   in `desktop-preview-distribution.md`. R2 billing activation and any plan upgrade
   are external account decisions; source tests do not establish that they exist.
4. Complete Paddle seller and payout verification for the South African business.
   Create the fixed one-time USD purchase and renewal catalog, approve
   `https://kerfdesk.com/buy.html`, configure the signed webhook and run complete
   sandbox purchase/claim, renewal, duplicate-delivery and interrupted-checkout
   scenarios. Set live credentials only after these pass. There is no staging
   service for them yet; see "No staging service" below. Never put private API or
   webhook keys in the browser or app package.
5. In Paddle, set both prices, purchase and renewal, to quantity minimum 1 and
   maximum 1, and apply no discount to them. The checkout page hides the discount
   field, and the service refuses any payment with another quantity or a discount.
   It records such a payment as refused, and support must refund it by hand
   (`desktop-commercial-support.md`). Include one refused sandbox payment in the
   scenarios above and check that the app shows the refusal and the lookup finds it.
6. Point an uptime monitor at `https://license.kerfdesk.com/v1/public/health`,
   expecting status 200 and `{"ok":true}`, right after the next redeploy. The
   route answers while licensing is switched off, but the Worker deployed from
   27855387e predates it (ADR-523 Amendment 3) and answers 503 until then.
7. Finalize seller identity, customer terms, privacy, refunds/chargebacks and support
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

The feed has two rings (ADR-541). A publication lists the release in the beta
catalogue (`desktop/commercial/beta/catalog.json`) only. Devices whose owner ticked
"Get new versions early (beta)" in Help > Licence read that one. Every other device,
and the download page, read the stable catalogue (`desktop/commercial/catalog.json`),
which changes only when a beta is promoted: its identical signed entry is copied
across, and nothing is signed again.

## Pilot verification

### No staging service

There is only the production licence service. Commercial builds are pinned to
`https://license.kerfdesk.com` (`scripts/prepare-commercial-desktop.mjs`), so every
pilot trial, activation and test order lands in the production database.

- A trial belongs to the Windows installation and cannot be started again, so run
  pilot trials on disposable Windows installations, such as a virtual machine, and
  never on the owner's own PC: a pilot trial there uses up that PC's one trial
  unless the trial is deleted through the administration API.
- Paddle's sandbox needs the service switched to `PADDLE_ENVIRONMENT=sandbox` with
  sandbox credentials. Doing that on the production Worker puts sandbox orders in
  the live database, and a sandbox payment, made with a test card, creates a
  licence signed with the production key that works in the real app. Revoke and
  delete every such licence, and switch the service back to live credentials,
  before selling.
- A separate staging Worker (its own name, hostname, database and signing keys,
  with a test build pinned to it) avoids both, but the build's pinned endpoint
  would have to change first.

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
ineligible release is skipped. Each publication reaches the beta ring only, and the
download page shows a version once `node scripts/promote-commercial-release.mjs
--expected-catalog-sha256 <sha256|none> <version>` has promoted it. Before
promoting N+1, prove that a device running N with "Get new versions early (beta)"
ticked takes N+1 and an unticked one does not; after promotion, the unticked one
takes it too. Verify installer publisher, hashes,
installed version, retained projects/settings, and public download/CORS/cache
behaviour.
Record the exact source, artifact and hosted identity. Only then enable customer
checkout and advertise automatic commercial updates.

The same change that enables checkout sets `UNLICENSED_BUILDS_RUN_FREE = true` in
`src/ui/licensing/edition-policy.ts` (ADR-544). The website's `trialOpen` and
`salesOpen` are set as `website/commerce.config.mjs` describes, and
`pnpm generate:site-pages` then takes the "KerfDesk Pro launches soon" line off
the website, the pricing and legal pages and `public/download.html` (ADR-524
Amendment 4); buyers purchase inside the app, never
through a checkout link on the website (ADR-524 Amendment 2). From that deploy, the web app and
the free Preview builds run KerfDesk Free and send Pro tools to the desktop app.
Before merging it, confirm the owner's own machines run the commercial build with
a developer licence, since the free builds stop offering Pro to him too. On the
signed commercial build, confirm that starting KerfDesk with
`--remote-debugging-port=9222` shows the refusal and opens no window.

## Weekly release train

`.github/workflows/release-train.yml` (ADR-541) builds, signs and publishes the
commercial Windows app every week. It is off until the owner switches it on, and
while off its only job writes a short summary of what switching it on needs.
Switch it on only once billing, Cloudflare R2 (`kerfdesk-downloads` behind
`dl.kerfdesk.com`) and Windows signing are in place and the pilot above has passed.

Once on, it works like this:

- **Tuesdays, 07:17 UTC.** If main has a user-facing change since the newest
  release, and CI, Browser smoke and the Desktop package check have all passed on a
  commit that includes it, the train checks its secrets on Linux, runs the Windows
  and macOS package checks on that commit, then builds, signs and publishes it to the
  beta ring as `<ISO week-year>.<ISO week>.<patch>`, for example `2026.40.0`. A week
  with nothing user-facing builds nothing and uses only Linux minutes.
- **Every day, 09:43 UTC.** Once the newest beta has stayed the newest for 4 days,
  and nothing holds it, it reaches everyone: the stable ring and the download page.
  A Tuesday beta is promoted from Saturday.
- It never tags, pushes or uploads to GitHub. Customers download only from
  `dl.kerfdesk.com`, and licensed devices still install updates only when they quit.

### Switching it on

1. In the repository's Settings > Environments, create `desktop-commercial` and
   limit its deployment branches to `main`.
2. Add these secrets to that environment. The workflow names them; their values
   never appear in logs.
   - `COMMERCIAL_ESIGNER_USERNAME`, `COMMERCIAL_ESIGNER_PASSWORD` and
     `COMMERCIAL_ESIGNER_TOTP_SECRET`: the SSL.com eSigner account holding the
     Windows code-signing certificate. The TOTP secret is shown at enrolment
     (ADR-142 Amendment 1).
   - `DESKTOP_STABLE_MANIFEST_PRIVATE_KEY`: the Ed25519 PKCS8 PEM of the pinned
     stable release key.
   - `COMMERCIAL_R2_API_TOKEN`: the Token value of an R2 API token with the Admin
     Read & Write permission (R2 > Manage API tokens), not the Access Key ID or
     Secret Access Key shown with it. The publisher sends it as a bearer token to
     Cloudflare's REST API, which reads the bucket first and does not accept
     Object Read & Write tokens (cloudflare/workers-sdk#9235). An Admin token
     reaches every bucket in the account, which holds only `kerfdesk-downloads`.
     The Preview's `PREVIEW_R2_API_TOKEN` is not needed here; it serves only
     `v*-preview.*` tags.
   - `COMMERCIAL_CLOUDFLARE_ACCOUNT_ID`: the 32-character ID of the account that
     owns that bucket and `dl.kerfdesk.com`.
3. Add these variables, to the environment or the repository:
   - `DESKTOP_STABLE_MANIFEST_KEY_ID`: `stable-2026-09`, the key the private key
     must match.
   - `DESKTOP_WINDOWS_PUBLISHER_NAME`: the certificate's publisher name, exactly as
     Windows shows it.
   - `KERFDESK_COMMERCIAL_TERMS_SHA256`: the lowercase SHA-256 of the approved
     installer terms. First upload those terms to the bucket as
     `desktop/commercial/terms/<sha256>.txt`; the train fetches them from
     `dl.kerfdesk.com` and refuses any other bytes.
4. Create the issue label `release-hold`.
5. Last, add the repository variable `KERFDESK_RELEASE_TRAIN` with the value `on`
   (Settings > Secrets and variables > Actions > Variables). It must be a
   repository variable, because the deciding job has no environment.
6. Run the workflow by hand with `status`. It reads both rings from `dl.kerfdesk.com`
   and changes nothing.

To switch the train off, delete `KERFDESK_RELEASE_TRAIN` or set it to anything but
`on`. A run already in progress finishes.

Before a Windows runner starts, a Linux preflight checks that every secret and
variable above is set, that the private key is the one `stable-2026-09` pins, that
the bucket answers and that the terms match their hash. A mistake there costs a
Linux job, not a Windows build.

### Holding a release

- To stop the newest beta reaching everyone, open an issue that says why and label
  it `release-hold`, or set the repository variable `KERFDESK_RELEASE_HOLD` to `on`.
  Promotion waits while either holds.
- Closing the last labelled issue, or removing the variable, releases the hold. The
  next daily run promotes the beta if it is still the newest and has had its 4
  quiet days.
- A published beta cannot be withdrawn: its files are immutable, and beta devices
  may already have installed it. Fix forward: merge the fix, then run the workflow
  with `cut` rather than waiting for Tuesday. The new beta replaces the held one,
  which is then never promoted.

### Running it by hand

In Actions > Release train > Run workflow, on `main`:

- `status` (the default) reports both rings and whether promotion is due, without
  secrets.
- `cut` makes the Tuesday decision now, and builds only if a beta is due.
- `promote` makes the daily decision now; the quiet days and holds still apply.

To put one release on the stable ring at once, for example an urgent fix, run
`node scripts/promote-commercial-release.mjs --expected-catalog-sha256 <sha256> <version>`
with the two R2 inputs (`scripts/commercial-release-README.md`), stating the stable
catalogue SHA-256 that the last `status` run printed after you reviewed it. Do it only
while no train run is in progress.
