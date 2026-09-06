# Preserved audit documents

Publication date: 6 September 2026

These reports, planning notes, and reproducer files were previously uncommitted in the primary checkout and historical audit worktrees. They are preserved here as historical evidence. Their findings and completion states describe the dates and source revisions inside each report; they have not been re-audited against current main for this publication.

| Material | Original scope and status |
| --- | --- |
| [Controller systems audit](2026-07-26-controller-systems-audit.md) | Read-only source/protocol report from 26 July at `de36b8674a8abf0c9276f5666ae34e14a3791476`. Its test results describe that historical baseline. The later CS-01 warning/evidence slice was published in [PR #450](https://github.com/cisgz3a-hub/KerfDesk/pull/450); this archive does not establish completion of the other controller findings. |
| [Burn-quality findings register](2026-07-17-burn-quality-findings-register.md) and [backing audit](2026-07-17-laser-burn-quality-audit.md) | Historical reports from 17 July in the audit worktree at `bd76af4b14ecc819a8414740785ce5b0bff6a89f`. The later revision-2 register corrects some backing-report claims. The proposed fixes remain a historical plan; this publication does not implement or establish completion of outstanding burn findings. |
| [RayForge gap planning ledger](2026-08-09-rayforge-gap-planning-ledger.md) | Deferred planning against the pinned 9 August baseline; this publication does not adopt its proposed features. |
| [Ten-loop repository audit](2026-08-30-ten-loop-repo-audit/README.md) | Partial audit record containing loops 1–5, coverage and findings ledgers, plus the observational loop-6 probe. It is not a claim that all ten loops finished. |
| [Feature code quality audit](2026-09-05-feature-code-quality/README.md) | Dated reports and local reproducers. The owning task subsequently reported its fixes integrated through PRs 728–732 and 744. These original audit notes are retained rather than rewritten as a fresh defect list. |
| [Website features and button audit](2026-09-05-website-features-and-button-audit.md) | Dated browser/source inventory, with the original coverage and verification limits. |

The July reports retain their original recommendations and limitations. The burn register's revision 2 removes F3 as a false positive and revises F4, while its earlier backing report still proposes an overlap-union fix. The backing report also describes `$30`/`$32` policy as blocking Start; that statement is stale against [PROJECT.md non-negotiable 21](../../PROJECT.md), where completed Frame is the sole ordinary Start guard and Job Review carries policy warnings. These historical statements are not current implementation instructions. No new physical-burn, controller, browser, or test qualification is supplied by archiving them.

The [loop-6 STL probe](2026-08-30-ten-loop-repo-audit/loop-06-stl-facet-boundary.test.ts.txt) originally lived at `src/__fixtures__/audit/loop-06-stl-facet-boundary.test.ts`. It deliberately records observed malformed-input acceptance. It is archived as text so this evidence does not make those observations required production behaviour. Reproducer imports and commands refer to their original checkout and may require adaptation before replay.

All historical TypeScript reproducers are stored as `.ts.txt` or `.tsx.txt` transcripts without registering obsolete baseline checks as current tests. The [source manifest](2026-09-06-preserved-audits-source-manifest.json) records original relative paths, archive paths, and SHA-256 fingerprints. Its three July-report entries also identify their source worktrees and heads. Reports, JSON, and captured text logs may receive whitespace, encoding, or line-ending normalisation for repository checks; original fingerprints describe the untouched donor files.

This publication changes no application source and runs no hardware. The active tracing audit and its browser profiles, caches, and generated evidence are managed separately by their owning task and are outside this archive.
