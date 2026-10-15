# Remaining image export, batch trace and AI qualification

This follow-up exercises the four previously partial software workflows. The root audit records direct computer-use screenshots separately. The test file adapter is explicitly labelled and stores actual command output in memory; it is not a native save-dialog qualification. AI uses a local synthetic provider, not a live paid API account.

## Confirmed defect repaired

Multi-File Trace checked cancellation before calling its export writer, but the writer could then wait for a save picker or filename collision lookup. Cancelling during that wait still allowed a new write to begin. Four regressions failed against the previous code. The batch now passes its live abort signal to the writer; picker resolution, collision probing and the final pre-write boundary check it. A fifth regression verifies the complete batch-to-writer path and the truthful zero-files cancellation message. Already-started writes retain their ordinary platform completion semantics.

## Per-tool evidence

| Tool | Executed software checks | Boundary retained |
| --- | --- | --- |
| Save Original Image | Real PNG/JPEG/BMP encoding and browser decoding; 64×64 dimensions and 2304 dark pixels; original PNG SHA-256 matches the source; unchanged artwork. Unit coverage includes missing canvas context, failed drawing and bitmap cleanup. | Native picker/physical filesystem acceptance was not available in this run. Maximum codec dimensions remain outside this bounded fixture. |
| Save Processed Bitmap | Real PNG output and decoded pixels, unchanged scene; existing raster/output parity, malformed pixels, missing source, cancellation and allocation-budget tests pass. | In-memory adapter completion does not prove native picker interaction. |
| Multi-File Trace | Real decoder and tracer process 32 duplicate-name PNGs into 32 distinct SVG outputs with identical hashes, skip an unreadable source, and leave artwork unchanged. Repeating a smaller batch preserves prior SVG receipts and allocates new collision suffixes. | The 32-file run is bounded stress, not a maximum-memory or long-duration production soak. Directory collision checks are not an atomic filesystem reservation against external writers. |
| AI Assistant | Real rendered dialog reviews synthetic geometry without committing; Apply adds one object; one Undo removes it. Delayed requests cancel; malformed drafts cannot be applied. Desktop route, parser, cancellation and isolated encrypted-storage tests pass. | Provider response is synthetic. No real credential, provider request, account change or generated-design quality claim. |

Research criteria remain those documented in the [original image audit](2026-10-15-tools-image-trace.md): bitmap resource ownership, source/processed distinction and trace approximation. This follow-up adds executable counterexamples and output evidence rather than treating implementation or citations as proof.

## Executed checks

- Image exports, AI dialog/desktop adapter and focused batch cases: 51 tests, seven files passed.
- Broader batch/file-adapter regression run: 81 tests, 14 files passed. This overlaps the previous group.
- Final cancellation regression file: five tests passed, including the additional batch propagation case.
- Desktop AI routes and isolated credential storage: 24 tests, two files passed.
- Initial development browser run: AI review/apply/Undo/cancel/rejection and PNG/JPEG/BMP/processed PNG workflows passed.
- Bundled file checks: 32-image batch and visible codec/output workflow passed. A separate extended rerun verified preserving previous batch outputs.
- Final acceptance bundle: all seven browser workflows passed in 16.1 seconds, with no skipped, failed or flaky tests. This includes the three registration workflows maintained by the other audit owner, AI review, actual image codecs/repeated batch collisions, 32 nonempty SVG outputs, and Cancel during a paused filename lookup with zero writes after resume. The 32-output check independently asserts the output count and positive parsed SVG path counts as well as hashes.
- The first bundled file assertions expected the directory-collision naming pattern for duplicate inputs. Core intentionally uniquifies input stems first (`audit-square-2-trace.svg`). Corrected assertions passed. The failed assertion receipts are retained; they are not product failures.
- Earlier development batch attempts were interrupted before the application menu became ready. Concurrent source/report reloads and cold module loading are not counted as workflow passes.
- E2E TypeScript now includes TSX fixtures and the DOM iterable libraries used by source. This exposed and repaired a legacy test fixture's nullable preference restore guard. Full E2E TypeScript, focused ESLint and formatting passed; the root audit records final integration checks separately.

## Reusable rendered fixtures

`e2e/fixtures/tools-ai-audit.html` renders the real App with explicit synthetic provider and file adapters. Visible controls queue a PNG, a duplicate/corrupt batch, or a 32-image batch. Captured exports expose downloadable bytes, decoded dimensions/path count, pixel preview and SHA-256. The delayed filename-lookup controls permit a direct Cancel → Resume reproduction without opening native dialogs. They are test-only entrypoints and are not included by the normal application build.

Automated workflows: `e2e/tools-ai-audit.e2e.ts`, `e2e/tools-file-audit.e2e.ts`, and the extended original-image export workflow in `e2e/tools-image-audit.e2e.ts`. Raw local receipts are under `artifacts/remaining-tools/`; the root audit publishes the final selected evidence.
