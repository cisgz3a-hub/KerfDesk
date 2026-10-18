## ADR-616 - Desktop releases retain evidence of customer delivery (2026-10-18)

**Status:** Accepted; maintainer approved the fixes, with delivery conditional on passing checks. | **Date:** 2026-10-18

### Context

The desktop release audit found a stale Windows installer description check,
short-lived qualification evidence, no automated public CDN/page check after
publication, and a signed beta waiting period measured from the planned release
date. The public Preview feed was absent even though older GitHub Preview
releases existed. Authenticated storage readback alone does not prove delivery
through the public download domain.

### Decision

- Validate Windows installer descriptions against `package.json` at each
  installer's authenticated source commit. Historical upgrade baselines keep
  their original metadata. Record the actual qualification checkout commit,
  independently of the GitHub event SHA.
- After manual Windows or Preview publication, verify the public signed latest
  and immutable manifests, exact source/version, artifact byte counts and
  hashes, and deployed download-page links. Manual downloads also verify the
  catalogue and signed notes. Recheck latest after reading artifacts. Requests
  are bounded, read-only and reject redirects; installer bytes are never run by
  this verifier. Website checks use an isolated Chrome browser.
- Keep raw workflow qualification, dependency and public delivery evidence for
  90 days. After every manual Windows delivery passes, retain a compact signed
  success receipt with the immutable release under
  `release-receipts/<runId>-<attempt>.json`. Bind it to the exact candidate,
  installer, native launch and historical upgrade, restored ASAR, lockfile and
  dependency results, public CDN and website. The public receipt uses an
  allowlist; raw paths, logs, screenshots and secrets stay out of it. This is
  durable evidence while the release object is retained, not a storage lock or
  independent attestation of a trusted workflow.
- Start automatic signed-beta probation from a separate authenticated
  `beta-observation.json`, written only after the exact newest beta is visible
  in the public catalogue. It binds the manifest digest, version and source.
  Missing or invalid observation means hold. Interrupted retries preserve the
  original observation. Explicit `release-train observe` recovery starts the
  clock when the operator actually observes publication; it cannot backdate
  evidence. Release identity dates and licence eligibility do not change.
  Deliberate manual promotion retains its existing timer override. Expose
  recovery as an explicit `action=observe` workflow dispatch with exact version
  and reviewed beta catalogue digest. Require the train switch, canonical
  repository, `main`, protected environment and shared publication lock. No
  schedule selects recovery; protected credentials remain in the workflow.

Publication can succeed before a later delivery/evidence step fails. That run
must report failure without rolling back immutable objects or pretending the
customer pointer was unchanged. Recovery requires reviewing the actual
publication and retained evidence; duplicate-source planning does not rerun
post-publication checks automatically. Capture the authenticated Windows
release identity immediately after confirmed publication so enabled companion
platforms retain a handoff even when a later Windows delivery or receipt audit
fails. Such an audit still fails the run. Cancellation, missing handoff or
failed/skipped companion builds cannot authorise companion publication.

The Preview feed must be created by an approved current Preview publication.
Do not fall back to GitHub downloads, invent a feed, or relax signature checks.
The release switches stay disabled throughout repair and verification. The
approved delivery must use the final merged source and pass all release gates.

### Verification and limits

Focused tests cover metadata from real Windows PE resources, mismatched source
and evidence, conflicting immutable receipts, public corruption and stale
pointers, beta observation recovery, and workflow ordering. Windows packaging
and native smoke are separate checks. Full installer/upgrade qualification
belongs on a disposable Windows runner because NSIS shares installation and
registry state with the developer's app. Free runner qualification does not
prove paid credential retention, standard-user UAC, SmartScreen or hardware.

ADR-613's separate commercial macOS/Linux lanes retain their own switches and
Windows-failure isolation. This decision's public verification and signed
success receipt cover manual Windows and Preview, not those commercial platform
feeds. Their current R2 readback and seven-day native artifacts do not establish
public CDN/page delivery or a durable success receipt. Keep those lanes disabled
until their publication and separate qualification are explicitly authorised.

Installed qualification also exposed an ambiguous nested Artwork-tab selector
and a project-seal request made before desktop startup completed. The harness
selects the outer tablist explicitly and retains console source locations.
Project-seal loading starts after native readiness and before project providers
mount, preserving ADR-592's existing file-operation wait. Absent optional Free
build entry helpers answer with explicit empty results; genuine renderer errors
still fail qualification.

Windows association qualification launches the app normally: a hidden shell
launch has no visible main-window title to verify. The exact-title, normal-close
and unchanged-project checks remain required, with bounded window observations
and failure screenshots retained for diagnosis.

The main-branch ruleset also requires `Desktop packaging gate`. Emit this named
aggregate after every packaging job, including failures and cancellations. All
ordinary Linux packaging and commercial-rehearsal jobs must pass; native jobs
may be skipped only when the existing native input is false. A selected native
run must pass all its Windows and macOS jobs. Missing or unknown results fail.

### Amendment 1: protected retry of an original failed success receipt

An explicit **Recover original desktop release receipt** dispatch on current
trusted main may retry only the receipt write/readback for an exact original
unsigned Windows run and attempt. The canonical repository, unsigned-release
switch, protected desktop-commercial environment and shared commercial-manual
publication lock remain required. This does not enable any release switch.

The current helper authenticates the current main ref through the GitHub API
before provenance reads and again before receipt storage; checkout credentials
remain unpersisted. It authenticates original GitHub run/attempt metadata and jobs,
including their repository, main branch, workflow path and control SHA. It
requires the original exact-source gate, build, dependency audit, native launch,
ASAR restoration, applicable historical upgrade, publication and public delivery
to have passed before the failed receipt step. All retained evidence uploads must
have succeeded. Artifact names include the original version and attempt; IDs,
repository/run/control provenance, upload time, expiry, archive sizes and SHA-256
are authenticated before bounded data-only ZIP reads. No recovered file is
executed or extracted into the checkout. Missing, ambiguous, expired or incomplete
provenance refuses recovery.

The signed candidate identity remains separate from the original workflow's
control SHA, which can differ for workflow_run. Both must be ancestors of current
main. Original native/dependency evidence retains its exact run, attempt, source
and installer identities; the lockfile is read inertly from that source with git
show. The original stable key identity is required. The ordinary receipt
validator and storage key remain unchanged: retries preserve the original
payload, evidence hashes and byte-identical immutable object, with conflicting
receipts refused. A separate recovery-run artifact records the control/source
identities and authenticated artifact IDs/digests.

This is historical evidence retention, not a fresh public-delivery check, build,
installer publication, latest/catalogue update or repair of earlier checks. It
may recover an upgrade-backed release after newer latest has appeared. It refuses
original failed/missing public delivery, cancellation, absent required checks or
uploads, and attempts whose reused jobs are absent from the exact attempt's
GitHub response. Those cases still require separately reviewed recovery. The
existing first-release guard still requires an authenticated catalogue containing
only that release; later history cannot be bypassed by an operator flag.
