## ADR-125 Amendment 3 - The phone's Import sheet shows the bed fit and every import notice (2026-10-27)

**Status:** Accepted; software-verified through browser tests that drive the built phone app
against a synthetic PC. Not tested on a real phone or against the production relay. |
**Date:** 2026-10-27

Extends [Amendment 2](ADR-125-amendment-2-remote-imports-report-the-bed-fit.md) to the phone app
(ADR-569, ADR-582), whose Consequences left the phone showing only "Imported.". Follows rolling
audit v5 finding J3-P2-3, which the refuter raised from P2 to P1: it is the phone half of rolling
audit v4 H8-P1-2. The coordinator re-verified it in code on main `09f7c0087`. Records the relay
deploy dependency of J3-P3-2. Changes nothing in Frame, Start or output.

### Context

Amendment 2 gave `import_file` receipts `notices` and `bedFit` and showed the PC the desktop's
toasts. The phone's Import sheet still passed a fixed `success: 'Imported.'` and read only
`changedArtworkIds`. A phone operator who imported a 1000 × 500 mm drawing onto a 400 × 400 mm bed
saw "Imported.", while the warning was an 8-second toast on the PC, a screen ADR-569's phone-only
workflow (import, Frame, Job Review, Start) never shows. The phone canvas and Transform size show
the scaled art, not the mismatch. A DXF with an unrecognised `$INSUNITS` comes in at the wrong
scale and looks like an ordinary small part.

### Decision

1. **The sheet reads the receipt.** `readImportReceipt` (`app/src/core/import-receipt.ts`) takes
   `notices`, errors and warnings first and then the rest, each group in the PC's order, and
   `bedFit`. Malformed entries are ignored.
2. **A clean import stays quick.** With no fit and only success notices, the sheet closes and the
   phone toasts the PC's own success line ("Imported big.svg (3 paths)."), or "Imported." from an
   older PC that sends no notices.
3. **Anything else is shown before the sheet closes.** A fit, or any warning, error or info notice,
   turns the sheet into "Check this import", which lists every notice.
4. **A bed fit needs an explicit choice.** With `bedFit` the review leads with "Scaled to N% to fit
   the bed" and the file and bed sizes, and it closes only through its footer: no Close button,
   backdrop or Escape. **Keep at N%** keeps the fit. **Restore file size** sends `undo` against the
   import receipt's own `revision`, so it undoes exactly the fit step (Amendment 2 item 3) or the
   PC refuses it as stale. If it is refused or its result is uncertain, the button stays disabled
   and the sheet says the fit may not have been undone and to check the size before Frame.
5. **No new gate.** The acknowledgement belongs to the import. Frame stays the sole ordinary Start
   policy gate (ADR-565), and Job Review and Start are unchanged.

### Consequences

- A phone operator learns about a bed fit, an assumed unit or a dropped part on the phone, before
  Frame (ADR-569 Amendment 3).
- The phone bundle (`public/app/`) and the MCP App (`electron/mcp/workspace-app-ui.ts`) are rebuilt
  from source by `build-app.mjs`, as `pnpm build:app --check` requires.
- **Relay deploy dependency (J3-P3-2).** The relay Worker re-parses every desktop result with the
  output schemas bundled into it (`relay.ts`, `device.ts`). A Worker built before Amendment 2
  strips `notices` and `bedFit`, so until the Worker is redeployed the phone and remote MCP clients
  see neither, and the sheet falls back to "Imported.". The local MCP server uses the desktop's own
  schemas and is not affected. The Worker deploy is the owner's step; this change adds no deploy.
