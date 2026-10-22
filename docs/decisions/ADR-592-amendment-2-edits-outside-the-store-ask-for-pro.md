## ADR-592 Amendment 2 - Edits made outside the store's actions ask for Pro too (2026-10-22)

**Status:** Accepted | **Date:** 2026-10-22 | **Amends:** ADR-592 decision 5 (Free edits settings, not artwork)

### Context

ADR-592 decision 5 says that without Pro, changing the outline of artwork bound
to a Pro operation, adding new artwork to it, or changing a relief's height data
asks for Pro "through every store edit path except history, document replacement
and save tracking". The guard (`proOperationMutationSetter`) wraps only the setter
the store's own actions receive. The 2026-10-21 rolling licensing audit (findings
02-P2-1, P3-2, P3-3) found UI modules that write the project through zustand's
public `useStore.setState` and so never asked: My artwork Insert (including
hand-edited `.lfart` files), retained-array Regenerate, barcode insert and edit,
AI draft apply, Photo engraving apply, Jig editor save and Studio snapshot apply.

PR #1346 routes those writes through the guard. That adds a Pro prompt where none
appeared before, so the 2026-10-22 PR audit asked the maintainer whether to
approve it, as `AGENTS.md` requires for entitlement checks. The maintainer
answered "Approve, record ADR". This amendment is that record.

### Decision

1. **Every project write from the UI goes through the Pro guard.** The store
   exposes `commitProjectEdit` (waits for the Pro prompt and applies once Pro is
   unlocked) and `commitProjectEditNow` (applies now or not at all, for dialogs
   that stay open). The paths listed above use them.
2. **The rule in decision 5 is unchanged.** Only new or changed artwork bound to
   a Pro operation asks. Moving, scaling, re-spacing an existing retained array,
   operation settings and removal stay free.
3. **A lint rule keeps it that way.** `kerfdesk/no-raw-project-set-state`
   forbids `useStore.setState` patches that write `project` in `src/ui`
   production code. A write that authors no artwork may keep a justified
   disable.

### Unchanged

The Pro check still never gates Preview, estimates, Frame, Start, Save G-code, a
running job or machine control. It never unmounts an open session, and the
workspace always opens. Policy findings remain Job Review warnings.

### Accepted limits

The lint rule matches the literal `useStore.setState`; an aliased store
reference would pass it. It is a tripwire for ordinary code, not a security
boundary, as ADR-544 already accepts for client-side checks.
