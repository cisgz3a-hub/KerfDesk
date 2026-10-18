## ADR-612 - Desktop releases retain evidence of customer delivery (2026-10-18)

**Status:** Proposed; release enablement awaits maintainer approval. | **Date:** 2026-10-18

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
  Deliberate manual promotion retains its existing timer override.

Publication can succeed before a later delivery/evidence step fails. That run
must report failure without rolling back immutable objects or pretending the
customer pointer was unchanged. Recovery requires reviewing the actual
publication and retained evidence; duplicate-source planning does not rerun
post-publication checks automatically.

The Preview feed must be created by an approved current Preview publication.
Do not fall back to GitHub downloads, invent a feed, or relax signature checks.
The release switches stay disabled throughout this repair and review.

### Verification and limits

Focused tests cover metadata from real Windows PE resources, mismatched source
and evidence, conflicting immutable receipts, public corruption and stale
pointers, beta observation recovery, and workflow ordering. Windows packaging
and native smoke are separate checks. Full installer/upgrade qualification
belongs on a disposable Windows runner because NSIS shares installation and
registry state with the developer's app. Free runner qualification does not
prove paid credential retention, standard-user UAC, SmartScreen or hardware.
