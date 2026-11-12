# C2 fix verification — areas

**Requested by** the maintainer on 2026-11-12, choosing "Verify the C2 fixes" after code quality audit C2 ([round result](../2026-11-11-code-quality-c2/LEDGER.md#round-result-2026-11-12)).

**Why.** C2 raised 82 findings, 41 of them P1 or P2. Ten fix PRs have merged and one is open. Rolling audit v14 showed that verifying fixes together finds what each fix alone misses: Z4 found the taper Fill loss, and D4 and D6 found the K40 route left out of the Moshi and Ruida fixes. So this round re-measures every fix on `main` and checks that the shared choke points can no longer be skipped.

## Loop

Each area runs once, one agent at a time:
1. an auditor;
2. a fresh refuter with its own method;
3. the coordinator re-checks every P1 and P2 in main's code;
4. a ledger in a docs pull request;
5. every confirmed P1 or P2 gets a fix, through the session that wrote the code.

Finding IDs are `E<area>-P<n>-<k>`. Severity is C2's: P1 harms a job, loses work or exposes a secret, or lets such a defect reach `main` unchecked. A test gap behind correct code is P2 at most.

## Areas (run order: each starts once its fixes have merged)

| # | Area id | Fixes verified | C2 findings | Method |
|---|---|---|---|---|
| E1 | `import-and-notice-fixes` | #1750, #1819, #1820, #1822, #1762 | D1-P2-4, D5-P1-1 (security, redacted), D5-P1-2, D6-P3-3, D2-P1-2, D2-P3-5 | Re-run the C2 repros, then the fix's own edge cases: angle wraps, PostScript work and time bounds (fuzzed again), notice angles, and `.rd` speed classes against the part-count limit. |
| E2 | `link-route-parity` | #1751, #1753, #1763, #1818, #1823 | D1-P1-1/P1-2/P2-1..5, D2-P1-1/P1-3/P2-1..3, D4-P1-1/P2-1..3, D6-P1-1..3/P2-1..3 | Re-run D2's rule × route matrix with the same job through G-code, Ruida `.rd` and UDP, Moshi, and K40 `.egv` and USB, comparing the decoded bytes. Check that a new link store cannot skip the job request, the warnings or the machine-work registry (type or test enforcement). Also check the JCZ route (#1725) if it has merged. |
| E3 | `guards-tests-ci` | #1808, plus the D3 test card, the D7 CI-fixes card and the main-is-green check when they merge | D3 gaps, D7-P1-1, D7-P2-1..3, the camera guard | Re-run D3's surviving mutants against main and confirm each new test kills its mutant. Re-measure CI: red time, verified-commit share, selector size, timeouts, and whether `main-is-green` blocks a merge onto red. |

## Rules

C2's rules apply:
- fresh `git archive` trees with a `node_modules` junction;
- agents report only;
- simulated controllers and stub cameras only;
- no pnpm, no building or packaging, no live services;
- memory gates: Vitest needs at least 1.5 GB free, a browser at least 2 GB;
- security findings stay redacted until fixed;
- fix PRs use auto-merge with the MERGE method, plus Auto-fix.

**Status:** started 2026-11-12. E1 first, because its fixes have merged. E2 waits for #1823, and E3 for the open cards.
