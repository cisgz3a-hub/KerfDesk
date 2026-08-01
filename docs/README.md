# KerfDesk documentation guide

This page separates living specifications from dated evidence so current product
truth is not inferred from an old audit, plan, or worktree.

## Living documents

| Document | Authority | Use it for |
|---|---|---|
| [`../AGENTS.md`](../AGENTS.md) | Operating contract | Repository identity, agent behavior, machine-control policy, and handoff expectations |
| [`../CLAUDE.md`](../CLAUDE.md) | Engineering standard | Enforced architecture, review conventions, tests, and verification commands |
| [`../PROJECT.md`](../PROJECT.md) | Product specification | Current scope, phase status, non-negotiables, and qualification boundaries |
| [`../WORKFLOW.md`](../WORKFLOW.md) | Workflow specification | User-visible success, error, empty, recovery, and edge behavior |
| [`../DECISIONS.md`](../DECISIONS.md) | Decision log | Accepted architecture and the rationale or supersession chain |
| [`../SECURITY.md`](../SECURITY.md) | Security policy | Vulnerability reporting and trust boundaries |
| [`safety.md`](safety.md) | Operator safety | Physical laser/CNC precautions and software limitations |
| [`../RESEARCH_LOG.md`](../RESEARCH_LOG.md) | Evidence register | Dependency adoption and time-sensitive external claims |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Contribution guide | ADR triggers, verification, PR expectations, and CI relationships |

For current behavior, verify the living document against current source and tests.
If a workflow passage is explicitly superseded, follow the later accepted ADR and
update the workflow rather than inventing a reconciliation.

## Operator and qualification guides

- [`connection-troubleshooting.md`](connection-troubleshooting.md) — browser,
  serial-driver, port, controller-response, and camera connection help
- [`laser-production-workflows.md`](laser-production-workflows.md) — concise
  operator notes for rotary, variable text, nesting, Print and Cut, cameras,
  materials, curve-native design, and output review
- [`hardware/laser-9-acceptance-protocol.md`](hardware/laser-9-acceptance-protocol.md)
  — de-energized and representative-hardware qualification procedure

Passing software tests is not hardware acceptance. A dated report may record the
state of one commit, but only current representative-hardware evidence can qualify
physical motion, placement, fire behavior, or burn quality.

## Workflow map

`WORKFLOW.md` is intentionally comprehensive. Read the relevant section instead
of loading the entire file.

| Area | Section prefix |
|---|---|
| App, project, import/export, preview, and baseline output | `F-A*` |
| Connection, controller state, Frame, Start, pause, stop, and recovery | `F-B*` |
| Machine Setup and general polish | `F-C*` |
| Text | `F-D*` |
| Trace/vectorization | `F-E*` |
| Fill, raster, origin, material, and laser production | `F-F*`, `F-ML*` |
| CNC/router, probing, streaming, and recovery | `F-CNC*`, `F-CNC-PROBE` |
| Multi-controller behavior | Phase I section |
| Box generator | `F-K*` |
| Image Studio | `F-L*` |
| Camera | `F-CAM*` |
| Windows desktop/release | `F-DESK*` |

Search by section id, visible UI label, or governing ADR with `rg`.

## Dated evidence and plans

[`audits/README.md`](audits/README.md) indexes audit reports, research, acceptance
records, and implementation plans. These files preserve what was known at a
specific date or commit. Their status statements do not automatically describe
current `main`.

`guard-remediation-plan-2026-07-15.md` is a superseded historical plan retained
for provenance. The current ordinary Start policy is governed by ADR-228, ADR-230,
ADR-232, ADR-237, `AGENTS.md`, and the current workflow.

## Generated and attribution documents

- `THIRD_PARTY_NOTICES.md` is the maintained human-readable attribution summary;
  `pnpm generate:notices` separately generates `public/third-party-notices.txt`
  from installed packages. Reconcile both with the production dependency tree
  and shipped artifacts when dependencies change.
- `src/__fixtures__/lightburn/external/README.md` records fixture provenance and
  hashes.
- `src/ui/library/design-library-cc0-sources.md` records bundled design sources.

These are records of provenance, not product or agent rules.
