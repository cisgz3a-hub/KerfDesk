# Latest-100-PR audit repairs

## Scope and baseline

The user requested repairs to the thirteen findings from the latest-100-PR audit.
Implementation starts at current main `4f1a33bc373dc5821a9b766a6e6385bb81f4de95`, in an
isolated checkout. The original audit used `288ad66baf23e0c75c0a05f6216787577ddc6812`.
The primary checkout and unrelated work were preserved.

Nine findings are already corrected in this baseline by merged work. The repair checks those
contracts rather than reapplying old candidate patches. Four findings still reproduce and are
corrected here. ADR-342 records the implementation contract.

## Finding disposition

| Finding | Resolution |
| --- | --- |
| M-01: worker refills an invalidated old run | Merged #826 retires the hosted queue at reset/takeover boundaries; real-worker regressions retained. |
| UI-001: cleanup deletes a newer autosave | Merged #826 compares the originally observed bytes/epoch; replacement-record regressions retained. |
| M-02: disconnect while the archive is pending strands recovery | Merged #829 retries on repository activation with run/generation/arm identity. This change adds an actual held-write regression. |
| M-03: crash after archive persistence leaves Start pending | Merged #826 recognises the exact persisted artifact before history activation; original restart probe passes on the repair baseline. |
| I-01: split oversized record fabricates an acknowledgement | This change retains discard-through-newline state in both serial read loops. |
| UI-002: older build deletes an incompatible autosave | This change preserves incompatible bytes through reads, retirement, subsequent writes and clears. |
| VIS-001: dense contour lists exceed JavaScript argument limits | This change uses iterative collection/bounds through affected fill, compilation and ordering paths. |
| VIS-005: bitmap conversion omits enabled Fill sub-layers | This change uses effective enabled operations and includes them in asynchronous conversion ownership. |
| VIS-002: preview budget counts containers instead of edges | Merged #826 counts motion edges for both second-route admission and packing. |
| VIS-003: inactive motion appears hot | Merged #826 binds burn rendering to active, certain process motion and laser state. |
| VIS-004: closing a trace leaves work running | Merged #826 propagates owned cancellation through the preview and worker. |
| M-04: duplicate Release motors after Z-only touch-off | Merged #826/#818 align the row and guide predicates. |
| UI-003: tutorial names a nonexistent Surface spoilboard menu | Merged #822 corrects the route. |

## Serial framing

Before the repair, the raw main-thread receive test delivers two acknowledgements for an
oversized record's `ok` suffix plus one real `ok`. The worker probe refills from that suffix.
An accepted-length record also loses its contents when its CR and LF arrive separately.
All three regressions fail on the repair baseline before the extractor changes.

Framing now retains a bounded partial plus an explicit discard flag. An overlong record releases
its buffered contents but keeps discard state through the same record's newline. It cannot be
reinterpreted as another acknowledgement, status, or error. One possible terminal CR may extend
the retained partial by one character; it does not extend the allowed record body.

The focused four-file cohort passes 55 tests. An independent whole-record oracle matches the
production extractor across 340 schedules and 1,336,937 reads, with a maximum retained partial
of 65,537 characters and no retained payload while discarding. Eight actual Chromium Worker
scenarios pass, including the new split-oversized-record case and existing ownership/reset cases.

## Delayed archive recovery

`job-checkpoint-archive-disconnect.test.ts` installs the real tracker, holds the backend artifact
write before commit and after commit/before promise resolution, and applies the production
`buildPortClosePatch`. After disconnect it releases the write and activates the archive without
another laser-store event. Both cases require exact recovery, the original acknowledgement count,
retained source G-code, no pending/active run and no spurious storage warning.

Both cases fail on the frozen audit baseline and pass on current main. The existing #829
implementation is retained. Ten integrated recovery files pass 99 tests, including replacement,
generation reset, completion and activation interleavings. The original M-03 durable crash-boundary
probe also passes. Counts overlap and are not one combined unique total.

## Autosave version preservation

The original valid-envelope/newer-project-schema witness fails for both localStorage and
IndexedDB before this repair. Incompatible project, snapshot-envelope and manifest versions
now remain untouched by recovery reads, retirement, interval writes, synchronous unload writes
and cleanup. IndexedDB mutation checks cover both generations within the mutation transaction.
A compatible current snapshot remains recoverable when only its previous generation is
incompatible; an incompatible current snapshot is not silently replaced by older history.

A durable writer that inherits a protected slot claims a fresh session before releasing the old
one, then retries its write. Queued cleanup decides ownership after any preceding rotation and
reacquires an abandoned-session lock before modifying a foreign slot. The observed-byte and
epoch comparisons from #826 remain intact. The UI explains that the retained backup requires
a compatible app version.

Independent review reproduced two defects in the first repair implementation: queued cleanup
could erase a new owner's local backup after rotation, and incompatible previous history hid
a compatible current snapshot. Both are corrected and represented in permanent regressions.
The unchanged external actual-service witnesses pass all four cases after those corrections.
The complete focused autosave cohort passes 94 tests across 12 files, including 16 version cases
and four rotation/ownership cases.

Three additional native Chrome cases exercise the production service and autosave worker with
real IndexedDB, localStorage and Web Locks. They cover both storage backends and compatible
current data with incompatible previous history. All require exact preserved original rows/bytes
after reads, writes and clear; a successful compatible save in a different session; release of the
old lock and ownership of the new one; and successful cleanup of the new current slot. All pass.

An unload before the first durable rotation cannot overwrite protected bytes. The existing
manual-save warning remains applicable if that synchronous fallback fails; a subsequent normal
durable write rotates and continues autosaving.

## Dense geometry and bitmap operations

VIS-001 is corrected at contour collection, offset accumulation, island bounds, compiler group
aggregation and path ordering. Iterative appends/reductions preserve all elements without
depending on JavaScript's function-argument limit. Existing winding rules, fallback geometry,
Sharp's direct hatch path and ordinary output policies remain in place.

External real-engine probes use disjoint squares and check complete finite geometry against
an independent cell oracle. Each heavy case ran in a fresh process:

| Input | Result at 150,000 contours | Measured time | Sampled process RSS |
| --- | --- | --- | --- |
| Imported SVG | 150,000 spans | 7.39 s | 1.25 GB |
| Multipath trace | All 150,001 spans, including its extra contour | 6.76 s | 1.26 GB |
| Nonzero trace | 150,000 spans | 5.88 s | 1.25 GB |
| Follow Shape / offset | 150,000 closed contours; natural termination | 45.18 s | 1.59 GB |
| Island fill | 150,000 spans in one connected island | 7.57 s | 1.28 GB |
| Sharp evenodd Scan Line | 150,000 spans | 0.265 s | 423 MB |
| Separate islands, full compilation and ordering | All 150,000 groups and cells retained | 10.27 s + 1.63 s | 1.31 GB |

These RSS samples are not peak-memory measurements. Large normalisation and offset workloads
remain expensive. A representative 5,000-contour case with both real normalisation calls
completes in 174 ms at 132 MB sampled RSS. Permanent collector regressions isolate the argument
boundary from the geometry engine's large heap while retaining real hatching and coverage
assertions. Existing topology/offset tests and the external probes cover actual engine semantics.

A further full-pipeline case uses the actual `prepareOutput` and `emitPreparedGcode` for
150,000 separate islands. Its independent modal G-code oracle finds all 150,000 source cells,
exactly 300,000 powered moves and 60,000 mm of expected powered path. Each powered move stays
within its original square. The 31,615,245-byte program passes preflight with no findings.
Preparation takes 11.14 s, emission/preflight 36.89 s and the independent oracle 1.78 s;
sampled process RSS is 1.58 GB. `dense-emitted-output.test.ts`, `dense-emission.config.mjs`,
`dense-emitted-full.log` and `dense-emitted-150000.json` preserve the executable probe and
measurements in the evidence directory. This is generated-output evidence, not machine operation.

VIS-005 now expands enabled parent/sub-layer operations through the compiler's canonical
resolver, including artwork-specific mode overrides. Explicit path/object bindings and legacy
colour bindings preserve their operations. Each Fill operation retains its own fill group;
independent/repeated fills keep the requested brightness without darkening overlap. Relevant
output, enabled or mode changes invalidate a conversion still in flight.

Seventeen focused files pass 135 tests across bitmap conversion, topology, winding, holes,
offset region coverage and ordering. A later three-file bitmap recheck passes 36 tests and
overlaps that count. Three native Chrome scenarios pass, including a Line parent with enabled
Fill sub-layer that produces all 15,000 expected grey PNG pixels with zero PNG/luminance
mismatches. Existing undo/redo, cancellation, busy controls and retry also pass.

## Repository verification

Application and E2E type checks, repository and Electron linting, formatting, ADR numbering,
GitHub Actions pinning and production dependency licensing all pass. The complete Vitest run
passes 15,547 tests, with 22 skipped, across 2,296 passing files and 14 skipped files. It finishes
in 1,309.30 seconds with no failed tests or worker errors. All 130 release-integrity tests pass.
Both the production web build and Electron main-code build pass, along with file-size and
public-export checks. The complete `pnpm release:check` finishes successfully in one invocation
(exit 0), including the full test run above. Existing bundle-size and legacy size/export advisory
reports remain; their configured gates pass without relaxing a limit.

The built web app also passes its native Chrome smoke test: hashed production assets load,
script text is edited through its packaged outline worker, and no page errors or failed asset
requests are observed. The first standalone Node CLI launcher exits with Windows status
`0xC0000409` before the test starts. Its two owned preview processes are stopped, and a clean
`pnpm exec playwright` launch passes the one smoke case in 5.7 seconds with unchanged source.
The original startup log and the passing retry are both retained as `production-browser.*`
and `production-browser-retry.*`. This is separate from the 14 focused native browser cases,
which all pass without skipped or flaky cases.

The final source snapshot is recorded in `source-snapshot.json`. All 37 changed source/test
files match the snapshot used by the successful repository verification. The changes are kept
on `codex/fix-last100-audit-20260922` in the isolated repair checkout.

The working evidence directory is `D:/LaserForge/fix-last100-audit-20260922-evidence`.
Its `autosave/README.md`, `visual/REPAIRS.md` and `recovery/RESULTS.md` identify the commands,
fixtures and logs. The original audit evidence remains separate and is not rewritten into
a passing result. Counts across focused, browser and repository cohorts are not added together
as one unique total.

## Qualification boundary

No physical controller or material was operated. Real Chromium workers and streams still use
simulated ports. Storage fault injection is not a killed-browser or power-loss qualification.
Dense-input success is measured for the recorded cases, not a universal memory/time guarantee.
No merge, deployment, provider action or installed-package qualification is part of this repair.
