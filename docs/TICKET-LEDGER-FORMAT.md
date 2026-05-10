# Ticket ledger format (T1-120)

This document defines the per-ticket status checklist that the audit
ledger requires before a ticket can be marked **Shipped**. It exists
because the audit repeatedly surfaced cases where a foundation was
built and tested in isolation but never wired into the live product —
`RecoveryState`, Falcon WiFi trust classification, MigrationPipeline,
server-signed entitlement tokens, controller abstractions. Each of
those was reported as "shipped" against a unit test and a type
declaration, while the running app continued to use the legacy
ad-hoc path.

## Ticket states

```
Status:
  - [ ] Type / API exists
  - [ ] Unit tests exist
  - [ ] Product path uses it
  - [ ] UI reflects it (when user-visible)
  - [ ] Integration / end-to-end test covers the wired path
  - [ ] Regression test added (if fixing a bug; not required for new features)

Shipped: yes / no / partial
```

A ticket may only carry **Shipped: yes** when both:

```
Product path uses it     = yes
Integration test covers  = yes
```

Anything less is **Shipped: partial** at most — the row stays in
`docs/ROADMAP.md`'s active list with a clear note about which boxes
remain unchecked.

## Definitions

- **Type / API exists**: a TypeScript interface, class, function, or
  module is added to `src/`. By itself, this is just code shape.
- **Unit tests exist**: a test file under `tests/` exercises the new
  API in isolation (no live wiring required). Sufficient for proving
  the API behaves correctly on its own.
- **Product path uses it**: at least one non-test file under `src/`
  or `electron/` imports / calls / consumes the new code from a
  production reachable surface. "Production reachable" means the path
  is hit during normal app use — connecting to a laser, opening a
  project, compiling a job, running a frame, etc. Test-only imports
  do not satisfy this.
- **UI reflects it (when user-visible)**: when the ticket's behavior
  is observable to the operator (status badge, blocker copy, menu
  item, modal), the UI surface that exposes it is in the production
  build. UI under feature flags off-by-default does not satisfy this.
- **Integration / end-to-end test covers the wired path**: a test
  mounts the real production path that consumes the new code and
  asserts the expected end-to-end behavior. Mock-only fixtures that
  call the new API directly without the production wrapper layer do
  not satisfy this — they prove the unit contract, not the wiring.
- **Regression test added**: when fixing a bug, a test that
  reproduces the pre-fix failure mode and demonstrates the post-fix
  behavior. Not required for purely additive work.

## Verification at commit time

Before writing `**Status:** Shipped in <hash>` in `docs/ROADMAP.md`,
confirm the wired-into-product gate from `CLAUDE.md`:

```
- (a) at least one non-test file under src/ or electron/ calls/imports
      the new code
- (b) at least one test file exercises the live wiring (i.e. mounts
      the real production path, not a mock-only fixture)
```

Concretely:

```bash
# (a) Production callers
git grep -l "<new-export-name>" -- src/ electron/ ":!tests/"

# (b) Integration coverage
git grep -l "<new-export-name>" -- tests/
# Then read those tests and confirm at least one mounts the live
# wiring rather than calling the helper directly.
```

If `(a)` is empty, the ticket is **type-only**. Document the gap in
the ROADMAP entry and ship as **partial** with a follow-up ticket
filed for wiring.

## Audit ledger annotation

When a ticket lands in `docs/ROADMAP-shipped-audit.md`, the row
should call out the wired-into-product evidence explicitly. Pre-T1-120
the ledger documented hashes and test files but did not distinguish
"type exists" from "product path uses it." Going forward each row
should state both — at minimum:

```md
| T<N>-<M> | <what> | Code: <file:line>; production caller: <file:line>;
            integration test: <test file>; <hash> |
```

When retrofitting an old type-only ticket, the entry should be moved
back to **active** with the gap documented and a follow-up filed. The
audit's specifically-flagged retrofit candidates were:

- `RecoveryState` (T2-? — runtime state defined, no canonical start
  gate consumes it)
- Falcon WiFi trust classification (defined, not action-gated)
- `MigrationPipeline` (defined, not in load path — closed by T1-119)
- streaming output / T3-15 (memory-bound design, no production
  emitter pipes through it)
- server-signed entitlement tokens (T2-89 framework, not consumed at
  runtime)
- controller abstraction (T2-24 split, only GRBL implements it)

## Why this matters

A solo-dev codebase with no review gate accumulates type-only tickets
when momentum overrides verification. The audit's own framing was
blunt: *"A ticket is not shipped when a type, helper, pure function,
or isolated test exists. A ticket is shipped only when the live
product path uses it and tests prove the user-visible behavior."*

This document operationalizes that.
