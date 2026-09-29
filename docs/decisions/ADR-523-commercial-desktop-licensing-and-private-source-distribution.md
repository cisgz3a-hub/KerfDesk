## ADR-523 - Opt-in commercial desktop licensing and public binaries from private source (2026-09-28)

**Status:** Implementation prepared; production activation, payments and signed release qualification pending.
**Amends:** ADR-024/120/247/248/249/522 for the specifically commercial distribution and public download transport.

### Decision and scope

The owner requested private-source distribution, public downloads, a full trial,
perpetual desktop licences and paid update renewals. The approved offer is USD49.50
for three active computers and one year of updates, with an optional USD20 further
year. The full trial lasts 30 days. Renewal is not a subscription. Johann and
Father each get a separate, privately issued developer licence with three active
computers and unlimited future update eligibility. Production keys have not yet
been issued to either person.

The repository was already private when this implementation began. That does not
revoke existing MIT grants, relicense third-party code, or settle ownership of
contributions. `LICENSE` remains unchanged. Final commercial terms, seller details,
privacy disclosures and the release-specific distribution rights must be resolved
before paid publication. Commercial packaging requires an explicit terms file;
the existing free-app installer notice is inappropriate for that offer.

### Separate channels

Existing web/PWA, free desktop and Preview builds remain admitted without a
licensing service. Only an explicitly prepared commercial package contains the
commercial metadata and signed release identity. Missing metadata selects free;
malformed commercial metadata fails closed. An ordinary update cannot migrate an
existing free installer into paid access: commercial updates use the separate
`https://dl.kerfdesk.com/desktop/commercial` namespace. Commercial installation is
an explicit user action. Windows signed NSIS is the first commercial update lane;
macOS remains an unsigned, manually installed Preview until its own signing,
notarization and update qualification exist.

Preview metadata and versioned assets move to a public R2 custom domain because
anonymous customers cannot download from the private source repository. Preview
discovery remains metadata-only, with manual installer downloads. Public-source
builds retain GitHub attestations; private Free-account builds identify their
provenance as a publisher signature. This is not an independent builder
attestation or an operating-system code signature. All assets are read back before
the public consumer manifest and latest pointer are exposed. Cadence counts only
completed distribution workflows, not an archive whose later publication failed.

### Licensing trust and machine operation

A Worker and SQLite Durable Object issue Ed25519 entitlements, enforce atomic
three-computer seats, and record durable payment idempotency. The main process
validates pinned signatures, the product, installation digest, release date and
claim schema. OS installation identifiers are product-hashed locally. Credentials
and pending payment claims use Electron asynchronous safeStorage; unavailable
secure storage cannot silently fall back to plaintext.

Admission happens before mounting the commercial workspace or exposing its project,
camera and serial surfaces. Admission is latched for that running session. Expiry,
deactivation, payment errors and update coverage changes do not interrupt a job or
remove controls. Frame remains the sole ordinary Start gate under ADR-228/230/232.
This change operates no machine and establishes no hardware qualification.

Paid eligible versions work offline indefinitely. A signed immutable release date
determines update eligibility; downloading today does not reset that date. The
updater chooses the newest eligible release, binds its installer size and SHA512
to the signed manifest, retains Windows publisher verification, respects the
updater's availability decision, and installs only on natural quit after another
cached eligibility check. The close handoff remains in force. There is no forced
restart and no renderer-controlled download URL or install command.

Trial clock high-water checks deter ordinary clock rollback, but this is not
hardware attestation or unbreakable DRM. A modified client or restored local state
can defeat local controls. Perpetual offline tokens cannot be immediately revoked
remotely; the seat server and normal client transfer policy do not change that fact.

### Payments and privacy

Paddle is the prepared provider for a South African seller serving US customers.
Live checkout stays disabled until merchant approval, catalog and sandbox
qualification. Initial and renewal prices are one-time USD amounts before
provider-added taxes. Only a verified raw-body payment webhook for a matching
server-created transaction grants or renews a licence. Browser completion events
only direct the customer back to the app to check payment.

Licensing sends only its documented installation digest, device label, credential
and order fields. No project, drawing, toolpath or machine/job data is uploaded.
The public checkout alone loads Paddle code; the workspace CSP remains confined
to its existing hosts. Provider connection metadata and the merchant's handling
of payment/customer records require disclosure before launch. No analytics or
crash-reporting service is added.

### Qualification and deployment boundary

Crypto, transactional concurrency, real local workerd/SQLite, renderer admission,
payment boundaries, public WebCrypto downloads and real electron-updater event
ordering have focused tests. These are source/local evidence, not hosted payment,
genuine signed upgrade, notarization or physical-machine evidence. See
`docs/desktop-commercial-launch.md`, `docs/desktop-preview-distribution.md` and
`services/desktop-licensing/README.md` for the remaining external setup.
