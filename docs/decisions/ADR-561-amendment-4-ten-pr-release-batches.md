## ADR-561 Amendment 4 - Release after ten merged PRs

Date: 2026-10-05

Status: Accepted by the maintainer's explicit instruction: "Change the new rule to 10 PRs per release".

### Decision

The automatic unsigned Windows release threshold is **10 distinct merged PRs** instead of 20. The planner's `RELEASE_PR_THRESHOLD`, workflow labels and operator instructions use 10.

Counting continues from the authenticated latest release's source commit. Existing unreleased PRs retain their place in the batch; changing the threshold does not reset the count. A successfully published release supplies the next baseline. The complete GitHub listing, source ancestry and one-count-per-merged-PR rules in ADR-561 Amendment 1 still apply.

An explicitly requested early release may still use `release_now=true` on `main`. Normal automatic releases wait for ten PRs. Both paths retain successful checks for the exact main push, package and Windows installer qualification, authenticated manifests, reviewed release notes and publication guards. The threshold change does not itself request an immediate release.
