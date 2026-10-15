# Focus Test implementation and verification

The former disabled menu item now creates a normal laser document containing 2–101 focus samples. Each sample's operation retains a represented relative Z offset and explicit Z travel feed. This uses the ordinary preparation, exact G-code, Save, Frame, Job Review and Start path. No hardware was operated during this audit.

| Quality requirement | Evidence / outcome |
| --- | --- |
| Design and research | ADR-602 cites primary GRBL documentation for M3/M4, spindle transitions and S0 motion; existing output cursor documents parser implementation evidence. Relative moves avoid inventing an absolute Z datum. |
| Laser-off Z motion | Every nonzero offset has an M5 / G91 / G1 Z… F… S0 / G90 sequence, followed by the matching return. A real dark XY move precedes M5 after constant-power burns. |
| Bounds and precision | Finite values, represented 0.001 mm distinct offsets, 2–101 samples, positive feed, bounded geometry and power validated. Configured Z travel and unconfirmed capability are warnings. |
| Output integrity | Full `emitGcode` retains all offsets through placement/optimisation. Non-Line overrides and raster groups cannot silently drop focus intent. CNC-mode focus output is refused by the shared compile-integrity path. |
| Persistence | Schema 18 protects semantics from older readers. Save/reopen retains offsets. Invalid persisted offset precision is rejected. Legacy migrations preserve documents. |
| Frame / recovery | Existing Frame gate preserved. Travel-feed changes retain spatial identity; offset changes invalidate it. Line-resume cannot reconstruct the original physical Z datum and is unavailable for these programs. |
| Stress | 101-sample deterministic bounded output and browser generation passed. 102 samples rejected; offsets collapsing at output precision rejected. |
| UI / Undo | Menu opens generator, invalid/empty inputs refuse Generate, Cancel preserves artwork, generation has one Undo step, Undo/Redo restored the complete document. |
| Browser workflow | Two Playwright workflows passed against the local desktop renderer on port 5197: exact-program 3D inspector, exported G-code, project Save/reopen/re-export, Undo/Redo; cancellation, invalid count and 101-sample boundary. Simulated file pickers only; serial-open/write event list remained empty. |
| Direct computer use | Recorded separately by the parent audit; Playwright evidence is not relabelled as manual CUA or installed desktop qualification. |
| Physical qualification | Not performed. Profile flags and software evidence do not establish Z clearance, controller wiring, focus quality or material results. |

The 2D planner estimate excludes additional Z travel and dark returns; the dialog and Job Review disclose this. **Inspect G-code (3D)** parses the exact emitted program and supplies the complete motion/playback estimate. Sample offsets are operation names, not engraved labels. Operators compare the physical lines with their document positions. An interrupted run can leave Z displaced; restore starting focus before another complete run.

Source and tests: `src/core/job/focus-test.ts`, `src/core/output/focus-test-emission.ts`, `src/ui/calibration/FocusTestDialog.tsx`, `src/core/job/focus-test.test.ts`, `src/io/gcode/focus-test-output.test.ts`, `src/io/gcode/focus-test-integration.test.ts`, `src/ui/laser/focus-test-identity.test.ts`, and `e2e/focus-test.e2e.ts`. Browser receipt: `artifacts/remaining-tools/focus-browser.json` (two passing tests, screenshot attachments). Parent audit owns durable receipt packaging and final aggregate check results.

The final code-quality extraction moved the existing field grid into a small component and extracted pure compilation checks. It changed no dialog content or emitted semantics; narrow UI and compilation regressions cover that final source change. Full source typecheck and E2E typecheck passed during implementation. Schema assertions in migration, start-point, image-clip and registration persistence tests were updated for version 18 rather than weakening their semantic assertions.
