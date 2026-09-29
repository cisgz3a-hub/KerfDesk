## ADR-556 - The legacy stable lane is off while commercial releases own version tags (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29 |
**Builds on:** ADR-024 and ADR-135/142 (the signed stable tag lane), ADR-523 (the commercial
desktop channel), ADR-541 (the weekly release train)

### Context

The desktop gap audit of 2026-09-29 (B9) found two release paths sharing one tag. A hand-run
commercial release is cut from a `vX.Y.Z` tag (`scripts/commercial-release-README.md`), and the
same tag starts `release-desktop-stable.yml`, the older lane that builds a signed free KerfDesk
installer and publishes it to `dl.kerfdesk.com/desktop/`. That lane stopped only while the
repository variable `STABLE_APPROVED_RELEASE_SHA` did not name the tagged commit, and the pilot
checklist asked the owner to check this by hand.

If both lanes ran, two different installers would carry the same version and the same app ID, so
one would replace the other on a customer's computer, and the free one carries no commercial
licence metadata. KerfDesk now sells one desktop app, the licensed one; nothing needs a free
stable desktop build.

### Decision

1. **The legacy stable lane is off by default.** Its first job runs only when the repository
   variable `KERFDESK_LEGACY_STABLE_LANE` is `on`. Every other job needs that job, so a
   `vX.Y.Z` tag with the variable unset skips the whole lane, whatever
   `STABLE_APPROVED_RELEASE_SHA` says.
2. **The lane is kept, not deleted.** Its signing, publishing and retry checks stay tested, so
   turning it back on is a reviewed variable change rather than rebuilding a release path.
3. **Commercial publication is unchanged.** The hand-run publisher and the release train
   (which never tags) are the only paths that publish a stable desktop release.

### Consequences

- Pushing a commercial `vX.Y.Z` tag can no longer build or publish a second, free installer
  with the same version.
- The pilot checklist item becomes "confirm `KERFDESK_LEGACY_STABLE_LANE` is not `on`".
- Each stable tag push still shows a skipped "Release Desktop Stable" run in GitHub Actions.
- The Preview lane (`v*-preview.*`) is untouched. It still keeps an internal GitHub prerelease
  archive next to the public `dl.kerfdesk.com` downloads; while the repository is public, that
  archive is publicly downloadable too.

### Tests

`src/platform/electron/release-desktop-workflow-gate.test.ts` pins the variable gate on the
first job, that the workflow has only that job and the build job, that the build job needs it
with no condition of its own, and that nothing uses `always()` to run past a skipped job. It
fails with the gate removed.
