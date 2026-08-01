# Contributing to KerfDesk

KerfDesk (repository name: LaserForge 2.0) is MIT-licensed. By contributing, you
agree that your contribution is distributed under the project's MIT license.

The project is under active development through Phase L, including the Image
Studio work adopted by ADR-242 and ADR-245. Code completion, simulator coverage,
and real-hardware qualification are tracked separately; never infer hardware
acceptance from a merged implementation or green CI run.

## Before making a change

1. Read [`AGENTS.md`](AGENTS.md) for the repository operating contract and the
   frame-first machine-control policy.
2. Use [`docs/README.md`](docs/README.md) to find the relevant product, workflow,
   architecture, safety, or historical document.
3. Confirm the behavior against current source and tests. Dated audit reports are
   evidence snapshots, not current truth.
4. Read [`SECURITY.md`](SECURITY.md) before investigating or reporting a
   security-sensitive issue.

## Documentation and decision gates

- Product scope changes require a `PROJECT.md` update.
- Architecturally significant, machine-policy, persistence-schema, dependency,
  or trust-boundary changes require an ADR in `DECISIONS.md`.
- New runtime dependencies require a current `RESEARCH_LOG.md` evaluation before
  code imports them.
- Routine bug fixes, tests, documentation corrections, and behavior-neutral
  refactors do not require an ADR.
- G-code snapshot changes require this PR-body line:
  `Snapshot change acknowledged: <reason>`.

## Machine-control changes

A completed Frame for the exact reviewed job is the sole ordinary operator-policy
gate for Start. Advisory policy findings belong in the Start-time Job Review.
Transport, compile, placement-input, handoff/recovery integrity, security,
capability, and destructive-intent boundaries remain valid refusals when the
operation cannot be executed correctly. See `AGENTS.md` and ADR-228/230/232/237.

Do not add or widen an ordinary machine-motion refusal without current evidence,
focused tests, an ADR, and explicit maintainer approval. Do not weaken security,
untrusted-input validation, experimental capability gates, low-power Fire
controls, recovery integrity, or physical interlocks under the frame-first rule.

## Verification

Use the smallest adequate bundle, then run broader gates in proportion to risk.

| Change | Minimum expected evidence |
|---|---|
| Documentation only | Prettier check, relative-link check, and verification of changed commands/claims |
| Bug fix | Failing reproduction where practical, focused tests, typecheck, and lint |
| UI workflow | Focused tests plus the relevant isolated Playwright or live-browser check |
| G-code/output | Focused property/snapshot tests and explicit snapshot acknowledgement |
| Release candidate | `pnpm release:check`; hardware/perceptual evidence remains separate |

`pnpm release:check` gates CI and production Pages deployment. Playwright browser
smoke runs in a separate PR/main workflow and is currently observability-only; it
does not block Pages deployment.

## Pull requests

- Keep one coherent intent per PR and preserve unrelated working-tree changes.
- Explain the root cause and user impact, not only the code diff.
- State what was verified and what was not, especially for machine, controller,
  browser, visual, and burn-quality behavior.
- Use Conventional Commit titles: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`,
  `chore:`, or `ci:`.
