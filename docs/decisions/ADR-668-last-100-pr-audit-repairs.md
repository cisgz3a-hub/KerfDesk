## ADR-668 - Repairs from the latest 100 PR audit (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

The owner asked to fix all seven findings from the audit of PRs #1328-#1427 and audit the fixes
again. The repair branch starts from `cff498219`, which includes #1427. The original findings
were reproduced on `3a7104653`; focused regressions establish the remaining defects on the new
baseline. This decision extends the existing behavior below without adding a licence or Start gate.

### Decisions

1. **Marlin macros use the existing stored-program boundary (R100-01).** M810-M819 store or
   execute commands outside the reviewed motion, so the external-program refusal from ADR-630
   Amendment 5 includes them. Their firmware command-number aliases are classified consistently.
   Generic positioning-light mappings also exclude these macros under ADR-603's existing
   no-movement contract. Normal accessory mappings and ordinary first-command parsing remain
   intact; serial escaping and G53 chaining are checked against the firmware's parser
   configurations, including quoted-parameter handling.
2. **A nudge belongs to the calibration it measured (R100-02, ADR-663 Amendment 2).** The photo
   request and result retain wizard, document, camera and calibration ownership. A late capture
   cannot change another wizard; Fix cannot apply an old offset to a replacement document or
   calibration. Measurement uses the captured bed frame rather than rereading another setup.
   A late ring-burn preparation completion also cannot overwrite a replacement wizard step.
3. **The newest camera-picture request owns publication (R100-03, ADR-663 Amendment 1).** Manual,
   keyboard and after-job refresh share request ownership. A later refresh, Live/hide action or
   changed source/document retires an older completion, including its failure notification.
4. **Quoted report secrets are removed as complete values (R100-04).** JSON string escaping and
   quoted key/value forms are handled when redacting diagnostic text. Complete key tokens are
   consumed once, avoiding repeated scans of long near-matches. Raw values never gain trust
   from a redaction-marker prefix. Report sections are redacted before assembly; incident cells
   remain redacted before escaping and are not reinterpreted as raw input afterward. Synthetic
   whole-report tests cover console and desktop-log sections; exporting a report does not transmit it.
5. **Diagnostic surfaces share controller password recognition (R100-05).** The bounded shared
   masker from ADR-667 is used by reports as well as visible-console copies. It recognizes the
   accepted numeric spellings and FluidNC descriptive/compatibility keys in both bracket and
   dollar syntax. Backup exports intended for restoration retain their existing contract.
6. **Tile-folder history covers the whole named job (R100-06, ADR-392 Amendment 2).** The platform
   adapter may enumerate immediate file names in a reserved folder without opening or changing
   their contents. Tile export reports old same-job tile names outside the current output set,
   including changed bit counts and a smaller grid. It leaves those files intact. An enumeration
   failure is a warning, not a save refusal; adapters without enumeration retain their earlier
   existence checks. Per-file native picker flows retain their existing behavior.
7. **Image-mode copy reflects the twelve existing choices (R100-07, ADR-649).** The product
   overview and website sources name Blue Noise and use twelve consistently. No raster algorithm
   or hardware-quality claim changes.

### Evidence and limits

The original findings and the new repair/review record live in `docs/audits/2026-10-23-last-100-pr-*`.
Regression logs, numerical probes and generated website previews are local build artifacts.
Verification is software evidence: no physical camera calibration, controller operation, air cut,
material cut, package publication or deployed-site qualification is implied.

Primary references: [Marlin macro implementation](https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/feature/macro/M810-M819.cpp),
[FluidNC settings parser](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/ProcessSettings.cpp),
[grblHAL numeric settings dispatch](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/system.c#L1208-L1210),
[JSON strings](https://datatracker.ietf.org/doc/html/rfc8259#section-7), and
[File System directory iteration](https://fs.spec.whatwg.org/#directory-iteration).
