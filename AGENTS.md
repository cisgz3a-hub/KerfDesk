# Repository agent guide

This is the tool-neutral operating contract for anyone using an AI coding agent in
this repository. Tool-specific entry points, including `CLAUDE.md`, defer to this
file.

## Start with the right tree

1. Confirm the repository root, branch, and working-tree state before reading or
   editing. `C:\Users\Asus\LaserForge` is a worktree hub, not the Git repository;
   the canonical checkout is `C:\Users\Asus\LaserForge-2.0`.
2. Preserve unrelated or uncommitted work. Do not copy rules from sibling
   worktrees without verifying them against current `origin/main`.
3. Read [`docs/README.md`](docs/README.md) and only the product, workflow, ADR, or
   safety sections relevant to the task. `DECISIONS.md` and `WORKFLOW.md` are
   large reference logs; do not load them end to end by default.

## Authority and document roles

- `PROJECT.md` defines current product scope and non-negotiable behavior.
- `WORKFLOW.md` defines operator flows. A later governing ADR wins over a passage
  explicitly marked historical or superseded.
- `DECISIONS.md` records architectural decisions and their rationale.
- `CLAUDE.md` records engineering standards and the commands that enforce them.
- `SECURITY.md` and `docs/safety.md` govern trust boundaries and physical safety.
- `docs/audits/` contains dated evidence, plans, and handoffs. It is not current
  product truth unless a living document or accepted ADR adopts a finding.

If two current authorities genuinely conflict, stop and ask the maintainer. Do
not resolve a product or safety-policy conflict by guessing.

## Machine-control policy

### Ordinary Start authorization is frame-first

For an ordinary laser or CNC job, a clean completed Frame for the exact reviewed
job is the sole operator-policy gate to Start (ADR-228, ADR-230, ADR-232, and
ADR-237). Calculated bounds, configured no-go zones, controller settings, and
other advisory findings belong in the Start-time Job Review and do not create an
additional ordinary Start policy gate.

The following remain valid refusal boundaries because the requested operation
cannot be executed correctly or through the available capability:

- transport readiness, controller ownership, and mutually exclusive operations;
- compile integrity and required placement inputs;
- exact-artifact, evidence-epoch, resume, and recovery consistency;
- security and untrusted-input validation;
- unsupported controller, platform, machine, or experimental capabilities; and
- destructive actions that need explicit user intent.

Do not interpret frame-first as permission to weaken input validation, browser or
Electron trust boundaries, low-power Fire hold-to-run behavior, capability/Labs
gates, recovery integrity, hardware interlocks, or the operator's physical
emergency controls. A new or wider ordinary machine-motion refusal requires
current evidence, focused tests, an ADR, and explicit maintainer approval. Prefer
an actionable warning when the operator can reasonably override the finding.

## Working mode

- For an audit or diagnosis request, stay read-only and report evidence unless
  the user also asks for a fix.
- For an implementation request, make the smallest coherent change that meets
  the goal. Keep refactors separate when they are not required for the change.
- Verify claims against the current tree. Historical audits, PR text, and nearby
  worktrees are leads, not proof.
- Never operate real machine hardware or mutate the maintainer's live scene
  without explicit permission. Use unit tests, simulators, isolated browser
  state, throwaway projects, and de-energized qualification procedures.
- Automated tests prove software behavior, not burn quality, physical placement,
  or perceptual fidelity. State the hardware or visual qualification that remains.
- Treat LightBurn as the default workflow reference where the product contract
  says it applies. An intentional divergence must be documented rather than
  silently treated as parity.

## Verification and handoff

Use the smallest verification bundle proportional to the change. Documentation
work normally needs formatting, link, and command/claim checks; source changes
normally need focused tests plus the relevant CI gates. `pnpm release:check` is
the complete release gate. Playwright browser smoke is a separate workflow and
does not currently gate deployment.

The final handoff should state the outcome, the evidence used to verify it, and
any important limitation or unverified physical behavior. Use headings only when
they improve a substantial handoff; routine answers do not need a mandatory
four-section template or a formulaic recommendation line.
