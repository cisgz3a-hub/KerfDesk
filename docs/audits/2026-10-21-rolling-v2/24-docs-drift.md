# Rolling audit v2 — Docs drift (governing claims vs code)

- **When:** 2026-10-22   **Tree:** origin/main @ `902f1d0c0` (the audit worktree HEAD
  `b32e27bc8` is that commit plus `docs/audits/` files only; `git diff --name-only 902f1d0c0 HEAD`
  lists nothing outside `docs/audits/`). Live GitHub state (ruleset 19573147, Actions variables,
  open pull requests, releases) was read with GET calls on 2026-10-22.
- **Scope:** cross-cutting. `PROJECT.md` non-negotiables 1–21, success metrics, Phase A acceptance,
  status and delivery paragraphs; every "enforced by / tested by / CI fails" style claim in
  `PROJECT.md`, `AGENTS.md`, `DECISIONS.md` and `docs/decisions/`; the AGENTS.md rules said to be
  mechanical (licence check before push, ADR numbering, ADR-010/015 size limits, the GPL-family
  rejection in `scripts/check-licenses.mjs`). Prior audits: `docs/audits/rolling/2026-07-17-0645-docs-vs-code-drift.md`,
  `docs/audits/2026-08-30-ten-loop-repo-audit/loop-01-governance-and-guard-contract.md`.
- **Lenses run:** L1 (each clause → enforcing file/test), L3 (doc claim vs code; doc vs doc;
  ADR vs ADR), L7 (do the guard tests test the guard?). L2 only for live repository state
  (GitHub API, the public download host). L4–L6 skipped: this area has no runtime input,
  trust boundary or failure path of its own; the product behaviour behind each clause was audited
  by areas 01–22, whose findings are cited as KNOWN.
- **Counts:** 8 raised → refuter: 8 confirmed, 0 plausible, 0 refuted; no severity changes →
  P1 0 / P2 0 / P3 8 (+13 KNOWN)

## Headline

No governing claim hides a broken safety guard: the laser-off, determinism, bounds and power-scale
properties, the snapshot tests, the pure-core and boundary lint rules, Abort reachability, the
Electron hardening flags and the ADR number gate all exist and check what they say. The drift is
in the documents and in the edges of the gates. `PROJECT.md` describes schema v7 (code: 18), an
ADR tail at 319 (main: 652) and closed payments (sales open since ADR-562 Amd 1). Several
non-negotiables point at a `CLAUDE.md` that has held no rules since #753 (2026-09-09). The
"400-line hard limit, enforced by ESLint" covers only `src/` and `electron/`: release and payment
scripts reach 588 counted lines. Two open pull requests (#1347, #1351) have both taken ADR-653
from the gate's "next free number", and with `strict` off and the merge queue unavailable, the
gate can only catch that after the second one merges.

## Findings

### P3-1 — `PROJECT.md` status, format, phase and CI paragraphs no longer describe the code (schema v7 vs 18, ADR tail 319 vs 652, payments "pending")
- **Where:**
  - `PROJECT.md:3`: "v4.1 … live commercial activation and payments remain pending … ADR tail at
    319".
  - `PROJECT.md:14-16`: "Current project format: schema v7 … The v4→v5→v6→v7 migrations". Same
    in `WORKFLOW.md:1572`. Code: `src/core/scene/project.ts:35`
    `PROJECT_SCHEMA_VERSION = 18`. The comments for v8–v18 sit above it, and v8 dates from about
    2026-09-24 (`5eaa9d483`).
  - `PROJECT.md:58` ("Every pull request checks both packages, installs the `.deb` on Ubuntu and
    launches it") and `:522` ("on Linux on every pull request, where it also builds the Linux
    AppImage and `.deb`, installs the `.deb` and launches it"). ADR-647 decision 3 (2026-10-20)
    skips both Linux installer jobs for renderer-only pull requests, and its header says it amends
    ADR-607/613 on exactly this point.
  - `PROJECT.md:348`: Image Studio "IE-4 Layers … Deferred". ADR-245 (Image Studio layers) is
    Accepted, and `src/ui/image-editor/LayersPanel.tsx` ships.
  - `PROJECT.md:350`: G-code Inspector "build starting at Stage 1". It ships, and ADR-627 made it
    Free. `PROJECT.md:366` (Design Studio "starting at DS-0") likewise; `src/ui/design-studio`
    exists.
  - `PROJECT.md:529`: "code signing and hosted qualification remain launch prerequisites". The
    unsigned commercial lane launched under ADR-523 Amendment 5 and ADR-562 Amendment 1.
- **Anchor:** Contract / Twin. These paragraphs are the session-start summary that `CLAUDE.md` and
  `AGENTS.md` send agents to ("Use `PROJECT.md` for product scope and current non-negotiables").
  Twins: `project.ts:35`, `check-adr-numbers` ("Next free number: ADR-653"), ADR-562 Amendment 1
  ("authorises the production payment flag"), `website/commerce.config.mjs:10` `salesOpen: true`,
  and ADR-647 decision 3.
- **Scenario:** An agent sizing a migration reads "schema v7" and plans a v8 bump, colliding with
  eleven existing versions. Or it reads "payments remain pending" and treats live checkout code as
  dormant. A reviewer told that every PR installs the `.deb` assumes a renderer-only PR proved the
  Linux installer, which ADR-647 says it does not.
- **Evidence:** READ plus REPRO. `node scripts/check-adr-numbers.mjs` prints "532 decisions (+167
  amendments) … Next free number: ADR-653". `gh release list` shows Previews through
  `v0.2.0-preview.13`, so that part of `:3` is still true.
- **Known parts (not re-raised):** `:59` closed sales (22-P3-8), `:40` remote scope (01-P3-10),
  `:42` desktop Free and Pro work (02-P3-6), `:664` desktop security (04-P3-8). The July rolling
  audit raised the same headline drift (P3-2, 12 ADRs stale). PR #272 fixed it then; it has since
  drifted by 333 ADRs.
- **Refuter:** CONFIRMED, stays P3.
  - Text: `PROJECT.md:3` still reads "payments remain pending" and "ADR tail at 319". `:14-16` is
    labelled "Current project format: schema v7", and `WORKFLOW.md:1572` matches it.
  - Code and decisions, read on my own: `project.ts:35` is `PROJECT_SCHEMA_VERSION = 18`.
    `ADR-562-amendment-1-authorised-payment-launch.md:9` "authorises the production payment
    flag", and `commerce.config.mjs:10` is `salesOpen: true`. `desktop-package-check.yml:14-17`
    skips the installer jobs for renderer-only pull requests (ADR-647).
  - The status rows are stale too. ADR-245 is Accepted, and `LayersPanel.tsx:107` ships blend
    modes, yet IE-4 still says "Deferred".
  - The ADR gate (run once) printed "Next free number: ADR-653".
  - Nothing labels these paragraphs as historical. They are headed "Status" and "Current".
- **Fix direction:** Rewrite the status block as a short pointer: current schema, current ADR tail,
  current release lanes and sales state. Better still, generate the schema and ADR-tail figures
  from `project.ts` and the ADR gate, so they cannot drift. Update `:58/:522` to ADR-647 and
  refresh the Phase L/M/N status tags.

### P3-2 — Non-negotiables 16 and 17, ADR-015 and the lint config point to `CLAUDE.md` rules that #753 deleted
- **Where:**
  - `CLAUDE.md` is 7 lines. It says to use `AGENTS.md` "as the single active repository
    instruction source". Commit `b61f7a544` (#753, 2026-09-09) removed 374 lines, including the
    size table, the single-responsibility rule, the co-located-test caveat and the import rules.
  - `PROJECT.md:475` NN16: "CI does not enforce a strict sibling rule (see CLAUDE.md); PR review
    rejects untested source changes".
  - `PROJECT.md:476` NN17: "Single responsibility per file (CLAUDE.md)".
  - `PROJECT.md:12` and `:752`: the source-of-truth row says `CLAUDE.md` is the "Operating manual
    … file-size limits, naming, anti-patterns, checklists".
  - `DECISIONS.md:472` ADR-015: "See `CLAUDE.md` for operational rules". ADR-016 (`:491`),
    ADR-132 ("CLAUDE.md's size table") and ADR-259 ("comments CLAUDE.md mandates") make the same
    kind of reference.
  - `eslint.config.mjs:3,145,149,190,243,258,267` cite CLAUDE.md sections that no longer exist.
    So does `scripts/check-soft-line-limit.mjs:4`.
  - `AGENTS.md` (58 lines) has no file-size table, no single-responsibility rule and no
    co-located-test rule.
  - #753 also removed the `repo-policy.test.ts` assertions that kept the written rules aligned
    with the config (`expect(manual).toContain('excluding blank and comment lines')`, `'600 raw
    physical lines'`, `'import/no-cycle'`, `'CI-ratcheted'`). The config pins remain; nothing
    pins the prose.
- **Anchor:** Contract. `PROJECT.md` NN16/NN17 name `CLAUDE.md` as the operative text. The only
  stated enforcement of NN16 is review, and main's ruleset requires zero approvals (report 11,
  candidates not raised).
- **Scenario:** An agent follows `AGENTS.md`, the only active instruction file. It never sees the
  co-located-test, single-responsibility or size rules that NN15–17 rely on. Following NN17's
  "(CLAUDE.md)" leads to a file that does not contain the rule.
- **Evidence:** READ. `git show b61f7a544 --stat` shows `CLAUDE.md | 374 +-----`; the
  `repo-policy.test.ts` diff is in the same commit. `grep -c CLAUDE.md DECISIONS.md` returns 51;
  41 `src/`/`electron/` files mention it.
- **Refuter:** CONFIRMED, stays P3. The scenario is narrower than stated.
  - `CLAUDE.md` is 7 lines with no rules. `git show --stat b61f7a544` shows `CLAUDE.md | 374`. The
    same commit removed the `const manual = repoFile('CLAUDE.md')` assertions from
    `repo-policy.test.ts`.
  - The citations still point there: `PROJECT.md:475-476` and `:752`, `DECISIONS.md:472`, and
    `eslint.config.mjs:3,145,149,190,243,258,267`. `AGENTS.md` has no line on size, single
    responsibility or co-located tests.
  - Correction: an agent is not left without the rules. NN15–17 state them inline (the sizes,
    "tests live beside their source", "One-sentence description without 'and'"), and `CLAUDE.md`
    sends agents to `PROJECT.md`. What is lost is the pointer and the detailed prose: counted
    vs raw lines, the 600/900 backstop and the import rules.
- **Fix direction:** Move the operative rules (size table, single responsibility, co-located
  tests) into `AGENTS.md` or a named section of `PROJECT.md`. Repoint NN16/NN17, the
  source-of-truth row, ADR-015 and the lint comments there. Optionally restore one
  prose-vs-config pin in `repo-policy.test.ts`.

### P3-3 — The "400-line hard limit enforced by ESLint" covers only `src/` and `electron/`; scripts (incl. release and payment) reach 588 counted lines, and lint exemptions carry no ADR
- **Where:**
  - `eslint.config.mjs:108,138`: `max-lines` 400, `max-lines-per-function` and `complexity` apply
    to `src/**/*.ts(x)` only. `eslint.electron.config.mjs:37` covers `electron/`.
    `services/remote-control` has its own limits.
  - The block for `scripts/**/*.mjs` and `website/**/*.mjs` (`eslint.config.mjs:346-353`) sets no
    size or complexity rule. `e2e/` gets none either.
  - Claims:
    - `PROJECT.md:495`: "No file in the repo exceeds 400 lines. Enforced by ESLint."
    - `PROJECT.md:474` NN15: "files ≤ 400 lines hard".
    - `PROJECT.md:779`: "no file > 400 lines; … no function > 80 lines".
    - `DECISIONS.md:464` ADR-015: "Hard limits enforced by ESLint".
    - ADR-259 Context (`DECISIONS.md:13436-13438`): "ESLint `max-lines` caps every file at 400
      counted code lines".
  - At least 8 scripts are over 400 *counted* lines (from `pnpm check:soft-size`):
    `scripts/refresh-sandbox-script.mjs` 588, `prepare-commercial-desktop.mjs` 551,
    `apply-payment-settings.mjs` 550, `performance-audit/hotpath-probe.mjs` 485,
    `refresh-sandbox-test-fixtures.mjs` 476, `third-party-closure.mjs` 461, `release-train.mjs`
    419 and `installed-app-file-io.mjs` 408.
  - 12 non-test `e2e/` files are over 400 raw lines (`e2e/production-workflows.spec.ts` has 1,635).
    In total, 349 tracked source files are over 400 raw lines.
  - The function and complexity limits are bypassed inline with no ADR. ADR-010 decision 9
    (`DECISIONS.md:396`) says "Exceptions require new ADRs".
    - `src/ui/layers/ReliefAuthoringDialog.tsx:34` disables `max-lines-per-function, complexity`
      on one 359-line component function: 4.5× the hard limit, added in `08afe91ca` on 2026-10-09.
    - `ReliefComponentControls.tsx:39` covers a 159-line function.
    - There are complexity disables at `text-outline-path.ts:14`, `curve-edit.ts:124` and
      `path-node-hit-test.ts:85`.
  - The scripts' own comments contradict each other:
    - `scripts/check-soft-line-limit.mjs:26-28` says tests "are exempt from the file-size limits".
    - `scripts/check-file-size-policy.mjs:5-10` says, correctly, that tests are still held to 400
      counted lines.
- **Anchor:** Contract. ADR-015 Context says "Enforcement (not aspiration) prevents recurrence";
  ADR-010 decision 9 requires an ADR for any exception.
- **Scenario:** The payment-settings and commercial-packaging scripts grow without any size or
  complexity gate, though the ADR says such growth "fails CI on violation". A 359-line component
  shipped as an unrecorded exception to the rule written against exactly that pattern (LF1's
  1,631-line `App.tsx`).
- **Evidence:** REPRO.
  - `eslint --print-config scripts/refresh-sandbox-script.mjs` shows no `max-lines` and no
    `complexity` entry, while `--print-config src/core/scene/project.ts` shows
    `"max-lines": [2, {"max": 400 …`. `e2e/production-workflows.spec.ts` has no `max-lines`
    either.
  - `node scripts/check-soft-line-limit.mjs` printed the counted-line figures above.
  - A TypeScript AST measurement gave the length of `ReliefAuthoringDialog` (lines 35–393).
- **Known part:** "React component 250 hard" (NN15, ADR-015) has no gate. 83 `.tsx` files are
  over 250 counted lines. The 2026-07-10 implementation plan (ARC-11) already classed this as an
  unenforced soft target and recommended a clarifying note, which never landed. Not re-raised.
- **Refuter:** CONFIRMED, stays P3, with one correction.
  - Config: `eslint.config.mjs:108` limits `max-lines` / `max-lines-per-function` / `complexity`
    to `src/**`. The `scripts/**/*.mjs, website/**/*.mjs` block (`:347-353`) sets only language
    options.
  - Files: `refresh-sandbox-script.mjs` has 598 raw lines (about 588 non-blank, non-comment).
    `prepare-commercial-desktop.mjs` has 598, `apply-payment-settings.mjs` 564,
    `e2e/production-workflows.spec.ts` 1,635. The five inline disables are at the lines cited
    (`ReliefAuthoringDialog.tsx:34`, from `08afe91ca`, 2026-10-09).
  - Correction: "grow without any size gate" overstates it. `check-file-size-policy.mjs:14`
    covers `scripts` and `website` with a 600-raw-line backstop, which `ci.yml:125` runs. Two
    scripts sit at 598, so that backstop is what currently holds them. `e2e/` is not in
    `checkedRoots` and is truly ungated.
  - ADR-010 decision 9 sits under ADR-010's own list. Using it as the anchor for ADR-015
    exemptions is arguable, but the exemptions are still unrecorded.
- **Fix direction:** Either extend `max-lines`, `max-lines-per-function` and `complexity` to
  `scripts/`, `website/` and `e2e/` (with a baseline for today's files), or state the real scope in
  ADR-015, NN15 and the success metric. Record the five exemptions in an ADR or split the
  functions. Fix the soft-limit script's comment.

### P3-4 — Seven runtime dependencies have no `RESEARCH_LOG.md` adoption entry
- **Where:** `package.json` `dependencies`, checked against `RESEARCH_LOG.md`
  (case-insensitive, 1,658 lines). These seven have no entry:
  - `saxes` and `linkedom`, added in `1a74ed12f` (#527, 2026-07-31). PROJECT.md `:508` names
    them as the SVG parse stack.
  - `@modelcontextprotocol/server` and `zod`, added in `72b0450d6` (#1051, 2026-10-01; the
    phone/MCP feature).
  - `@csstools/css-calc`, `@csstools/css-parser-algorithms` and `@csstools/css-tokenizer`, added
    in `da1ff076f` (#1139, 2026-10-11).
- **Anchor:** Contract.
  - ADR-017 policy 7 (`DECISIONS.md:541`): "Every adopted dependency gets a `RESEARCH_LOG.md` row:
    name, version, license, last release date, justification, evaluation date … alternatives
    considered".
  - `PROJECT.md:496` (success metric) and `:783` (Phase A acceptance 6).
  - NN20: libraries "pass evaluation policy (ADR-017): license, maintenance, fit, size, CVE status".
- **Scenario:** The parser that every file-backed SVG import goes through, and the MCP server
  that accepts remote edits, entered the shipped bundle with no recorded maintenance, CVE or
  bundle-size evaluation. Nothing in CI checks the log. Only `pnpm license-check` covers the
  licence part.
- **Evidence:** REPRO. A node script listed each `dependencies` key with its `RESEARCH_LOG.md`
  hit count; those seven are 0. `git log -S'"<name>"' -- package.json` gives the adoption commits.
  ADR-269 (`DECISIONS.md:14204`) mentions `saxes`/`linkedom` as design, not as an ADR-017
  evaluation.
- **Refuter:** CONFIRMED, stays P3.
  - A case-insensitive search of `RESEARCH_LOG.md` for
    `saxes|linkedom|modelcontextprotocol|zod|csstools|css-calc|css-tokenizer|css-parser-algorithms`
    returns 0 hits. `package.json:80-103` lists all seven as runtime `dependencies`.
  - `DECISIONS.md:541` (ADR-017 policy 7) requires a `RESEARCH_LOG.md` row specifically.
  - Partial mitigation, which does not refute it: `docs/mcp/research-20261001.md:12` records a
    pin and rationale for the MCP TypeScript SDK. It has no licence, release date or
    alternatives. No other document evaluates `saxes`, `linkedom`, `zod` or `@csstools/*`.
- **Fix direction:** Add the seven ADR-017 rows. Optionally add a small check that every
  `dependencies` key appears in `RESEARCH_LOG.md`.

### P3-5 — Nothing tests that `pnpm license-check` rejects a GPL-family licence; the only pin is a string grep
- **Where:**
  - `scripts/check-licenses.mjs:22-42` is the allowlist, `:44` the top-level `execSync('pnpm
    licenses list --prod --json')`, and `:56-62` the rejection loop. The script exports nothing,
    so no test can import its logic.
  - The only test, `src/platform/web/repo-policy.test.ts:48-57`, asserts that `package.json` runs
    the script and that the file *contains* `pnpm licenses list --prod --json`.
  - No `check-licenses.test.mjs` exists, and `test:release-integrity` covers 90-odd scripts but
    not this one.
- **Anchor:** Contract.
  - `AGENTS.md:52`: "New dependencies must pass `pnpm license-check`, which rejects GPL-family
    licences".
  - `PROJECT.md:32`: "GPL-family dependencies remain rejected".
  - ADR-017 policy 2: the script "is the enforced production-package allowlist".
  - L7: the repo's own `repo-policy.test.ts` header exists because documented-but-unconfigured
    gates recurred (H14, M29, M34).
- **Scenario:**
  - An edit adds `'GPL-3.0-only'` to `ALLOWED_LICENSES` "to unblock" a dependency. Or it changes
    the loop's `continue`, or turns `process.exit(1)` into a warning.
  - Every test and every CI job stays green, and the next GPL dependency passes.
  - The licence decision is the one AGENTS.md calls irreversible for a public repository.
- **Evidence:** READ (grep: `check-licenses` appears only in the script itself,
  `services/remote-control/package.json:16` and `repo-policy.test.ts`).
- **Known context:** report 11 verified by reading that the gate is a fail-closed allowlist today,
  and raised its `--prod` blind spot (11-P3-5). The missing behavioural test is new.
- **Refuter:** CONFIRMED, stays P3 (the guard is fail-closed today; only its test is missing).
  - Code: `check-licenses.mjs` has no `export`. `execSync` runs at the top level (`:44`), and
    the rejection loop and `process.exit(1)` are module-level (`:55-74`). No test can import the
    logic.
  - Tests, searched across `src`, `scripts`, `services`, `e2e`, `electron`, `audit`, `website`
    and `.github`:
    - `repo-policy.test.ts:54-56` checks only the script name and the string
      `pnpm licenses list --prod --json`.
    - `deploy-workflow-gate.test.ts:281` checks only that a workflow runs `pnpm license-check`.
    - `test:release-integrity` names no licence-check test.
  - No second guard: `third-party-closure.mjs` and `generate-third-party-notices.mjs` read the
    same inventory but reject only a missing or empty LICENSE file, never a GPL licence. So a
    weakened allowlist would let a GPL dependency through every gate.
- **Fix direction:** Split the allowlist check into an exported pure function. Then add a
  `node --test` case to `test:release-integrity` that feeds a fake `pnpm licenses` map with `GPL-3.0-only`,
  `LGPL-2.1`, `AGPL-3.0` and `(MIT OR GPL-2.0)` and expects rejection, plus an empty map that also
  fails.

### P3-6 — Non-negotiable 8 names the licensing service as the only exception, but approved phone/MCP relay and AI requests send project and machine data off the machine
- **Where:**
  - `PROJECT.md:464`: "No … cloud sync, project data, machine data or job data leaves the machine …
    Only the explicit commercial channel may send … to the licensing service."
  - Approved paths it does not list:
    - ADR-564 (`docs/decisions/ADR-564-remote-editing-and-mcp.md:7,13`): an outbound WebSocket to
      the first-party Worker at `electron/remote-access/relay-types.ts:1`. Its tools "read
      artwork/operation summaries, machine limits"; ADR-568 adds artwork previews and ADR-569
      adds machine control.
    - ADR-571 (`docs/decisions/ADR-571-…md:15`): the AI assistant sends "the prompt, dimensions
      and task, plus … recipe descriptions and optional selected photo" to
      `https://api.openai.com/v1/responses` (`electron/ai/provider.ts:28`).
  - Neither ADR amends NN8, and NN8 cites only ADR-523.
- **Anchor:** Contract (doc vs doc). NN8 is a non-negotiable; ADR-564/571 are later approved
  decisions that change its scope without saying so.
- **Scenario:**
  - A reviewer checking a privacy change against NN8 reads that only licensing traffic may
    leave. That makes either the shipped relay and AI features look like violations, or NN8 look
    like dead text.
  - The website privacy copy derives from these rules; its own inaccuracies are KNOWN (22-P3-2,
    22-P3-4).
- **Evidence:** READ.
- **Refuter:** CONFIRMED, stays P3.
  - `PROJECT.md:464` names only the release and licensing services, checkout, and download
    statistics.
  - Two paths leave the machine:
    - `relay-types.ts:1` points at the `workers.dev` relay, and ADR-564's Decision lists
      tools that "read artwork/operation summaries, machine limits".
    - `provider.ts:28` posts to `api.openai.com`, and ADR-571's Decision discloses request
      contents.
  - Neither ADR mentions NN8, telemetry or "leaves the machine". Earlier off-machine ADRs did
    amend NN8 explicitly: ADR-024 (`DECISIONS.md:4566`), ADR-563 (`:33`) and `DECISIONS.md:12384`.
    So the convention exists and these two skipped it.
- **Fix direction:** Amend NN8 to list each opt-in, user-initiated off-machine path, with its ADR:
  the phone/MCP relay, the AI assistant (operator's own API key) and the update/download
  catalogue. Keep "no telemetry" as the invariant.

### P3-7 — Non-negotiable 1 still says paths "must fit inside the configured bed", while non-negotiable 21 and the code make bed overhang advisory only
- **Where:**
  - `PROJECT.md:457` NN1: "generated paths must fit inside the configured bed".
  - `PROJECT.md:483` NN21: "Calculated bed overhang … may inform that review but may not refuse
    Frame or Start".
  - Code: `src/core/preflight/preflight.ts:273-314` turns out-of-bed coordinates into
    `code: 'out-of-bed'` review issues.
  - `src/core/invariants/predicates.ts:88-90` still labels the bounds scanner "non-negotiable #1 …
    must fall inside".
  - No ADR or PROJECT.md sentence reconciles the two. Searched `DECISIONS.md`, `docs/decisions`
    and `WORKFLOW.md` for "non-negotiable 1/#1"; nothing found.
- **Anchor:** Contract (doc vs doc), ADR-206 (new guards need the maintainer's permission), and
  the 2026-07-18 guard inventory (`docs/audits/2026-07-18-guard-inventory-frame-first.md:68`:
  placement-bounds check "DEMOTED").
- **Scenario:** An agent fixing an overhang report reads NN1 ("must fit") and adds a refusal at
  Frame or Start. That is exactly what NN21 and ADR-206 forbid, and it would cite the
  non-negotiables list as authority.
- **Evidence:** READ.
- **Refuter:** CONFIRMED, stays P3.
  - Doc vs doc: `PROJECT.md:457` reads "generated paths must fit inside the configured bed";
    `:483` says calculated bed overhang "may not refuse Frame or Start".
  - Code: `src/core/preflight/blocking-codes.ts:20` classes `out-of-bed` as a heuristic
    non-blocking code. `preflight.ts:289-314` only pushes issues. `predicates.ts:88-90` still
    cites "non-negotiable #1 … must fall inside".
  - A search of `PROJECT.md`, `DECISIONS.md`, `WORKFLOW.md`, `AGENTS.md` and `docs/decisions/`
    for non-negotiable 1 / NN1 / "Bounds check" finds no reconciling sentence.
- **Fix direction:** Reword NN1 as "Bounds disclosed: output that leaves the configured bed is
  reported in Job Review (NN21)", and keep the in-bed property test as the emitter invariant for
  in-bed inputs.

### P3-8 — Two open pull requests both took ADR-653 from the gate's "next free number"; with `strict` off and no merge queue, the gate can only catch it after the second merge, on main
- **Where:**
  - `AGENTS.md:27`: "run `node scripts/check-adr-numbers.mjs` for the next free number".
  - `scripts/check-adr-numbers.mjs:129-137` computes that number from the checkout only.
  - Open PRs (GET, 2026-10-22):
    - #1347 `docs/decisions/ADR-653-remote-control-keeps-pc-guards-and-fails-closed.md`, opened
      2026-10-21 11:45Z.
    - #1351 `docs/decisions/ADR-653-audit-repair-program-document-and-remote-fidelity.md`, opened
      14:59Z.
    - These are two different decisions. Earlier, ADR-650 (#1348) and ADR-651 (#1339) were also
      taken off main.
  - Live ruleset 19573147: `strict_required_status_checks_policy: false`.
  - ADR-645 is stale and has no back-reference:
    - Status (`:3`): "The maintainer turns the queue on". Context (`:8`): the ruleset "requires a
      branch to be up to date".
    - ADR-647 Context (`:12-13`) says the queue "cannot be turned on" and up-to-date "was already
      off". ADR-645 does not point to ADR-647.
    - `scripts/merge-queue-workflows.test.mjs:7` still says "main merges through GitHub's merge
      queue".
- **Anchor:** Contract / Twin. The gate's own header (`check-adr-numbers.mjs:3-10`) says
  collisions must be caught at merge, because "two correct reviews of two correct branches still
  produce a collision". ADR-344 says numbering is global.
- **Scenario:**
  - #1347 merges. #1351's green PR checks are not re-run, because `strict` is off and there is no
    queue.
  - #1351 merges. Main's push CI then fails `check:adr-numbers` ("ADR-653 claimed 2x"), which
    blocks `deploy.yml` and the unsigned release lane until someone renumbers.
  - Meanwhile code comments in both branches cite "ADR-653" for different decisions. This is the
    2026-07-25 ADR-257 incident the gate was written for.
- **Evidence:** LIVE plus REPRO.
  - `gh api …/pulls/{1347,1351}/files` shows both files and their `## ADR-653` headings.
  - `gh api …/rulesets/19573147` shows `"strict":false`.
  - `node scripts/check-adr-numbers.mjs` passes on main and prints ADR-653.
- **Known context:** 11-P3-4 (ruleset `strict` off, contrary to ADR-621) and 11-P3-6 (amendment
  numbers not keyed). This finding is the live decision-number collision and the stale ADR-645
  premise.
- **Refuter:** CONFIRMED, stays P3 (the gate works as designed; the gap is merge-time ordering).
  - Live (2026-10-22): `gh pr view 1347/1351 --json files,state` shows both OPEN.
    - #1347 adds `ADR-653-remote-control-keeps-pc-guards-and-fails-closed.md`.
    - #1351 adds `ADR-653-audit-repair-program-document-and-remote-fidelity.md`.
    - At their heads (`05559db1f`, `4773ac350`) both files start with `## ADR-653`, for different
      decisions.
    - Both are `mergeStateStatus: CLEAN`, with auto-merge off.
  - Main: `origin/main` is `902f1d0c0`, and its highest decision file is ADR-652. The gate (run
    once) passes and prints "Next free number: ADR-653".
  - Ruleset 19573147: `strict_required_status_checks_policy: false`, and there is no
    merge-queue rule.
  - The workflows still carry the dead `merge_group` trigger (`ci.yml:7-10`).
  - ADR-645 is stale: `:3` reads "The maintainer turns the queue on", and the file never
    mentions 647. `merge-queue-workflows.test.mjs:7` still says "main merges through GitHub's
    merge queue".
  - Not raised: no user-facing behaviour is affected. The gate would fail main's push CI and hold
    deploys, which is process breakage, so P3 is right.
- **Fix direction:**
  - Short term: renumber one of #1347/#1351 before either merges.
  - Durable options: have the gate (or a PR job) also read open PRs' `docs/decisions/` names via
    the API, or allocate numbers by reservation. Re-enabling `strict` on main also works.
  - Add a status note to ADR-645 pointing to ADR-647, and correct the test comment.

## Known (encountered, not re-raised)

| ID | Claim touched | Prior report |
|---|---|---|
| K1 | NN15 / ADR-015 "React component 250 hard" has no gate (83 `.tsx` > 250 counted) | 2026-07-10 implementation plan ARC-11 |
| K2 | ADR gate does not key amendments; two "ADR-378 Amendment 1" files | 11-P3-6 |
| K3 | Licence gate and notices read `--prod` only (Workbox ships unlisted) | 11-P3-5 |
| K4 | Nothing keeps `LICENSE-MIT`/`COPYING` out of the root | 11-P3-11 |
| K5 | Main ruleset `strict` off and Desktop packaging gate not required (ADR-621) | 11-P3-4 |
| K6 | `PROJECT.md:59` website "sales closed" | 22-P3-8 |
| K7 | `PROJECT.md:40` remote-access scope | 01-P3-10 |
| K8 | `PROJECT.md:42` "Desktop Free continues to load and output existing Pro work" | 02-P3-6 |
| K9 | `PROJECT.md:664` desktop security paragraph | 04-P3-8 |
| K10 | `AGENTS.md:34` "paid 30 days" check-in | 02 (AGENTS.md P3) |
| K11 | NN3/NN13 property tests miss M3 dialects, raster, power mode, 4040 travel; vacuous raster predicates | 03 (L7 P3s) |
| K12 | NN4 "no partial output" broken by save-picker truncation on seven export paths | 19-P2-1 |
| K13 | ADR-524 Amd 3 "`generate-site-pages.test.mjs` fails when a committed page differs" is false; also its `pnpm generate:site-pages` alias does not exist in `package.json` | 22 (site-pages freshness P3) |

Known violations of other non-negotiables that areas 01–22 already carry (NN2: 03-P2-3; NN7:
03-P2-4/P2-5; NN21: 13-P1-1, 01-P2-1/P2-2) were checked for currency only and are not counted here.

## Refuted

Candidates considered and dropped, so later audits can skip them:

- **NN12 / ADR-010 decision 3 ("only `index.ts` exposed") vs 3,107 deep `core/` imports from
  `ui`/`io`/`platform`.** `PROJECT.md:650-651` states the actual policy ("focused public APIs
  rather than … every folder must have an `index.ts`"). Deep imports were triaged in July
  (ARC-05). The direction of imports is enforced. Not raised.
- **`PROJECT.md:666` preamble "M3 S0" vs code arming the dialect's word (`M4 S0` for dynamic) at
  `grbl-strategy.ts:95`.** The laser-off meaning holds, so this is a simplification, not drift
  with consequence.
- **`check-licenses.mjs` allowlist vs ADR-017's list:** there is no bare `Zlib` entry, and
  compound `OR` expressions are not parsed. Both differences fail closed, so this is
  conservative, not a gap.
- **Index-export gate counts `export *` as 0.** It is latent: no barrel uses `export *`
  today, and the gate prints the lower bound.
- **No mechanical pre-push licence check.** Nothing claims one: ADR-543 decision 9 makes it an
  agent rule. The release-time checks and the root-file gap are K4.

## Verified clean

- **ADR integrity:**
  - The gate passes with 532 decisions and 167 amendments, all numbers unique; the next free
    number is ADR-653.
  - `DECISIONS.md` ends at ADR-343 and `docs/decisions/` starts at ADR-344, matching `AGENTS.md:27`.
  - There are 120 unused numbers, mostly the reserved block ADR-054–091 and renumbering gaps.
    ADR-650/651 are held by open PRs.
- **Code citations of ADR-635…652** match their files, including the renumbered ADR-637
  (machine setup), ADR-638 (Start review) and ADR-640 (jog cancel). No stale pre-renumber
  citations.
- **Referenced enforcement artefacts exist:**
  - Of 1,350 backticked script and test references across `PROJECT.md`, `AGENTS.md`,
    `WORKFLOW.md`, `DECISIONS.md` and `docs/decisions/`, all resolve except six historical test
    names deleted with their components.
  - For example, `JobReviewLayersTable.test.tsx` was renamed `JobReviewOperations.test.tsx` in
    `72908ce2a`, and `start-blocked-fix-offers.test.ts` was deleted in `655455cbf`.
  - Every `pnpm <script>` cited exists, except `generate:site-pages` (K13).
- **NN3:** `findLaserOnTravelIssues` (`predicates.ts:54-86`) implements the NN3 text exactly
  (inline S0, preceding M5/M107, sticky S0). Its unit tests include the negative case. 100-run
  properties for laser-off, determinism, bounds and power scale exist
  (`grbl-strategy.property.test.ts:33-155`, `OUTPUT_FUZZ_RUNS = 100`), plus Marlin and
  Smoothieware twins. Coverage gaps are K11.
- **NN5/NN14:** there are 14 `.snap` files. The five Phase A fixtures are snapshot- and
  determinism-tested (`pipeline.snapshot.test.ts`). Every test file runs in CI: four shards, no
  excludes.
- **NN9:**
  - Ctrl+. ignores the modal and editable-target gates (`use-job-shortcuts.ts:6-10,21-27`).
  - The Live Motion bar stays above dialogs (`LiveMotionBar.test.tsx:345`).
  - ESLint H13 bans native `alert/confirm/prompt` everywhere except `job-aware-dialogs.ts`.
- **NN10/NN11:** the pure-core bans (globals, Node imports, `Date.now`, `Math.random`,
  `new Date`) and the boundary matrix are configured and pinned by `repo-policy.test.ts`.
- **NN18/NN19:** `switch-exhaustiveness-check` is an error in both lint configs.
- **NN8 (code side):** there is no analytics, crash-reporting or telemetry SDK in `src/`,
  `electron/` or `website/`. The live NEL headers and the catalogue fetch are KNOWN (22).
- **Electron hardening** (`PROJECT.md:506`): `desktop-window-options.ts:25-28` sets
  `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`, with a test. There is
  no `ipcMain` and no preload.
- **Licence window:** `DESKTOP_LICENCE_WINDOW = false` (`public/desktop-licence-window.mjs:7`),
  as `AGENTS.md:34` says. No licence or edition symbol appears in the `src/ui/laser`
  Start/Frame/output paths.
- **Linux status (`PROJECT.md:58`, "until the maintainer turns them on"):**
  `KERFDESK_UNSIGNED_LINUX_RELEASES` is unset, and
  `dl.kerfdesk.com/desktop/commercial-manual/latest-linux.json` returns 404.
- **Gate wiring:** every `release:check` gate runs in `ci.yml` (`:99-131`), and `audit.yml` runs
  nightly at 03:17 UTC, as `PROJECT.md:668` says. The index-export ratchet behaves as documented,
  with 14 legacy barrels pinned.

**Observation, not raised:** at least 41 ADRs in `docs/decisions/` declare that they amend or
supersede an earlier ADR whose text never points back. Examples:
- ADR-334's status still says "Off by default", though ADR-354 superseded it.
- ADR-565 (NN21's ADR) has no pointer to ADR-605.
- ADR-540 has no pointer to ADR-627.

The amendments do declare themselves, so this is a navigation gap, not a silent contradiction.
ADR-645 is the case with a consequence (P3-8).

## Not verified

- **Web bundle budget** ("< 1 MB compressed", ADR-017 policy 5 and `PROJECT.md:679`): no build
  was run under the current load.
- **Content claims:** WORKFLOW.md flow content, and topic-matching of every ADR citation in
  `src/` beyond ADR-635…652.
- **Deferred non-negotiables:** NN2, NN6, NN7 and NN21 were not re-audited behaviourally. They are
  covered by areas 03, 05, 13, 17 and 18 at `faf5a54f1`…`902f1d0c0`. Only the 32 commits since
  `2c8d988db` were scanned for Start/Frame changes, and none touched those paths.
- **Merge-order guarantee:** whether GitHub re-runs required checks on #1351 if #1347 merges
  first depends on manual action. The scenario assumes no re-run, which is the default with
  `strict` off.

```json
[
  {"id":"P3-1","severity":"P3","area":"docs-drift","file":"PROJECT.md","line":3,"anchor":"Contract/Twin: PROJECT.md status vs project.ts:35 PROJECT_SCHEMA_VERSION=18, ADR gate tail 652, ADR-562 Amd 1, ADR-647 d3","evidence":"READ+REPRO","verdict":"CONFIRMED","known":"partly: 22-P3-8 (:59), 01-P3-10 (:40), 02-P3-6 (:42), 04-P3-8 (:664); July rolling P3-2 precedent","summary":"PROJECT.md says schema v7 (code 18), ADR tail 319 (main 652), payments pending (sales open), every PR installs the .deb (ADR-647 skips it), Image Studio layers deferred and G-code Inspector unbuilt (both shipped)"},
  {"id":"P3-2","severity":"P3","area":"docs-drift","file":"PROJECT.md","line":476,"anchor":"Contract: NN16/NN17, ADR-015, source-of-truth table point to CLAUDE.md rules removed by #753","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"CLAUDE.md has held no rules since #753 (374 lines removed, alignment assertions dropped from repo-policy.test.ts), yet NN16, NN17, ADR-015/016/132/259 and eslint comments cite it; AGENTS.md carries no size, single-responsibility or co-located-test rule"},
  {"id":"P3-3","severity":"P3","area":"docs-drift","file":"eslint.config.mjs","line":346,"anchor":"Contract: ADR-015 hard limits enforced by ESLint; PROJECT.md:495 success metric; ADR-010 d9 exceptions need ADRs","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: component-250 row is 2026-07-10 ARC-11","summary":"max-lines/function/complexity apply only to src and electron; 8 scripts (payment, commercial packaging, release) exceed 400 counted lines (max 588), e2e ungated; ReliefAuthoringDialog is one 359-line function under an ADR-less eslint-disable"},
  {"id":"P3-4","severity":"P3","area":"docs-drift","file":"RESEARCH_LOG.md","line":1,"anchor":"Contract: ADR-017 policy 7, PROJECT.md:496 and :783, NN20","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"saxes, linkedom, @modelcontextprotocol/server, zod and three @csstools packages (runtime dependencies since 2026-07-31..10-11) have no RESEARCH_LOG adoption entry"},
  {"id":"P3-5","severity":"P3","area":"docs-drift","file":"scripts/check-licenses.mjs","line":22,"anchor":"Contract: AGENTS.md:52 GPL-family rejection, ADR-017 policy 2; L7","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No behavioural test of the licence gate: only a string grep pins it; adding GPL-3.0 to the allowlist or weakening the loop keeps every test and CI green"},
  {"id":"P3-6","severity":"P3","area":"docs-drift","file":"PROJECT.md","line":464,"anchor":"Contract (doc vs doc): NN8 vs ADR-564/568/569 relay and ADR-571 OpenAI requests","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"NN8 says only licensing traffic may leave and no project or machine data leaves, but approved phone/MCP relay (summaries, previews, machine limits) and AI assistant (prompt, photo) paths are not listed and no ADR amends NN8"},
  {"id":"P3-7","severity":"P3","area":"docs-drift","file":"PROJECT.md","line":457,"anchor":"Contract (doc vs doc): NN1 vs NN21 and ADR-206; code preflight.ts:273-314 warning-only","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"NN1 still says paths must fit the bed while NN21 and the code make overhang a Job Review warning; nothing reconciles them, inviting a forbidden Frame/Start refusal"},
  {"id":"P3-8","severity":"P3","area":"docs-drift","file":"scripts/check-adr-numbers.mjs","line":129,"anchor":"Contract/Twin: gate purpose (merge-time collisions), AGENTS.md:27, ADR-344; ADR-645 vs ADR-647","evidence":"LIVE+REPRO","verdict":"CONFIRMED","known":"related: 11-P3-4, 11-P3-6","summary":"Open PRs #1347 and #1351 both add a different ADR-653 from the gate's next-free number; with strict off and no merge queue the duplicate is only caught on main after the second merge; ADR-645 still says the queue is turned on"}
]
```

## Appendix — claim → enforcement → status

| # | Claim (source) | Enforcement found | Status |
|---|---|---|---|
| NN1 | Paths must fit the bed (`PROJECT.md:457`) | `predicates.ts:91` `findOutOfBoundsCoords`; `preflight.ts:273-314` warning; in-bed property test (`grbl-strategy.property.test.ts:56`) | Advisory in code; wording conflicts with NN21 → **P3-7** |
| NN2 | Origin honesty | Origin transforms in output (area 03) | Enforced; rotary rebase KNOWN 03-P2-3 |
| NN3 | Laser off on travel, property-tested | `predicates.ts:54-86` + 100-run properties (GRBL/Marlin/Smoothie) | Holds; coverage gaps K11 |
| NN4 | No partial output | Single-string emission; Save swap file | Broken on export paths: K12 (19-P2-1) |
| NN5 | Deterministic, snapshot-tested | Determinism properties + 14 `.snap` files | Holds |
| NN6 | Units mm inside pipeline | Conversions only at G20 parse, controller reports, DPI and numeric input | Holds (READ) |
| NN7 | Power scale honest (ADR-567) | `grbl-laser-lines.ts` | KNOWN 03-P2-4/P2-5 |
| NN8 | No telemetry; licensing the only exception | No telemetry SDK; relay (ADR-564) and OpenAI (ADR-571) paths exist | Code clean; text incomplete → **P3-6**; site items KNOWN (22) |
| NN9 | Abort reachable from any window state | `use-job-shortcuts.ts:6-27`; `LiveMotionBar.test.tsx:345`; ESLint H13 | Holds |
| NN10/11 | Pure, platform-agnostic core | `eslint.config.mjs:244-297` + `repo-policy.test.ts:63-75` | Holds |
| NN12 | Module boundaries are public APIs | Boundary direction matrix (`eslint.config.mjs:54-67`); no entry-point rule | Direction enforced; `PROJECT.md:650` discloses the rest (Refuted) |
| NN13 | All invariants property-tested | `src/core/invariants/*` + property tests | Partly: K11 |
| NN14 | G-code snapshot-tested | `src/io/gcode/__snapshots__`, `src/io/svg/__snapshots__` | Holds |
| NN15 | Files ≤ 400 / components ≤ 250 / functions ≤ 80 hard | ESLint for `src`, `electron`; 600/900 raw backstop elsewhere; 5 inline disables | src/electron only → **P3-3**; component row K1 |
| NN16 | Co-located tests; "see CLAUDE.md"; review rejects untested changes | None (by design); 0 required approvals | Pointer dangling → **P3-2** |
| NN17 | Single responsibility (CLAUDE.md) | None | Rule text gone → **P3-2** |
| NN18/19 | Discriminated unions, extensible SceneObject | `switch-exhaustiveness-check` error (both configs) | Holds |
| NN20 | Libraries pass ADR-017 evaluation | `check-licenses.mjs` (licence only, `--prod`) | 7 deps unlogged → **P3-4**; `--prod` K3; untested → **P3-5** |
| NN21 | Frame the only Start guard; licence not a guard | Start/Frame paths free of licence symbols; areas 05/17/18 | Holds on changed lines; KNOWN 13-P1-1, 01-P2-1/2 |
| SM | "No file > 400 lines. Enforced by ESLint" (`PROJECT.md:495`) | ESLint `src`/`electron` only | False → **P3-3** |
| SM | Every dependency in `RESEARCH_LOG.md` (`:496`) | None | False → **P3-4** |
| ST | Status line, schema v7, ADR tail 319, payments pending, every-PR `.deb` | `project.ts:35`, ADR gate, ADR-562 Amd 1, ADR-647 | Stale → **P3-1** (parts K6–K9) |
| ST | Linux downloads off until switched on (`:58`) | `KERFDESK_UNSIGNED_LINUX_RELEASES` unset; Linux feed 404 | Holds |
| ST | Previews published through `v0.2.0-preview.13` | `gh release list` | Holds |
| AG | `DECISIONS.md` = ADR-001…343, files from ADR-344 (`AGENTS.md:27`) | `check-adr-numbers.mjs` | Holds |
| AG | Run the gate for the next free number | Gate reads checkout only | Live ADR-653 collision → **P3-8**; amendments K2 |
| AG | Push only with "All rights reserved" `LICENSE` | Agent rule (ADR-543 d9); release-lane checks | No hook, none claimed; root files K4 |
| AG | `pnpm license-check` rejects GPL-family | Allowlist, fail-closed | Holds today; untested → **P3-5**; `--prod` K3 |
| AG | Licence window held off (`DESKTOP_LICENCE_WINDOW`) | `public/desktop-licence-window.mjs:7` | Holds |
| AG | Paid devices check in every 30 days (`AGENTS.md:34`) | Licensing clock trial-only | K10 |
| ADR-015 | Hard limits enforced by ESLint; index exports 20 hard | ESLint (`src`); `check-index-exports.mjs` ratchet | File scope → **P3-3**; component K1; ratchet holds |
| ADR-010 d9 | Exceptions require new ADRs | — | 5 inline lint disables without ADR → **P3-3** |
| ADR-259 | ESLint caps every file at 400 counted lines | Not for `scripts`/`website`/`e2e` | **P3-3** |
| ADR-524 Amd 3 | Site-pages test fails on stale committed pages; `pnpm generate:site-pages` | Test renders to temp; no such script | K13 |
| ADR-645 | Main merges through the merge queue; ruleset requires up to date | Queue unavailable (ADR-647); `strict:false` | Stale → **P3-8**; K5 |
| — | Every backticked script/test reference in governing docs | 1,350 references checked | Resolve, bar 6 historical tests |
