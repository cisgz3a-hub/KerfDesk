# Preserved audit documents

Publication date: 6 September 2026

These reports, planning notes, and reproducer files were previously uncommitted in the primary checkout. They are preserved here as historical evidence. Their findings and completion states describe the dates and source revisions inside each report; they have not been re-audited against current main for this publication.

| Material | Original scope and status |
| --- | --- |
| [RayForge gap planning ledger](2026-08-09-rayforge-gap-planning-ledger.md) | Deferred planning against the pinned 9 August baseline; this publication does not adopt its proposed features. |
| [Ten-loop repository audit](2026-08-30-ten-loop-repo-audit/README.md) | Partial audit record containing loops 1–5, coverage and findings ledgers, plus the observational loop-6 probe. It is not a claim that all ten loops finished. |
| [Feature code quality audit](2026-09-05-feature-code-quality/README.md) | Dated reports and local reproducers. The owning task subsequently reported its fixes integrated through PRs 728–732 and 744. These original audit notes are retained rather than rewritten as a fresh defect list. |
| [Website features and button audit](2026-09-05-website-features-and-button-audit.md) | Dated browser/source inventory, with the original coverage and verification limits. |

The [loop-6 STL probe](2026-08-30-ten-loop-repo-audit/loop-06-stl-facet-boundary.test.ts.txt) originally lived at `src/__fixtures__/audit/loop-06-stl-facet-boundary.test.ts`. It deliberately records observed malformed-input acceptance. It is archived as text so this evidence does not make those observations required production behaviour. Reproducer imports and commands refer to their original checkout and may require adaptation before replay.

All historical TypeScript reproducers are stored as `.ts.txt` or `.tsx.txt` transcripts without registering obsolete baseline checks as current tests. The [source manifest](2026-09-06-preserved-audits-source-manifest.json) records original relative paths, archive paths, and SHA-256 fingerprints. Reports, JSON, and captured text logs may receive whitespace, encoding, or line-ending normalisation for repository checks; original fingerprints describe the untouched donor files.

This publication changes no application source and runs no hardware. The active tracing audit and its browser profiles, caches, and generated evidence are managed separately by their owning task and are outside this archive.
