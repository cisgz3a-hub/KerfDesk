# Online Audit Prompt Sources - 2026-06-01

Scope: external prompt/checklist material used to shape the LaserForge 2.0 whole-repository audit. This file records sources and how they were adapted; it does not copy external prompts wholesale.

## Sources Used

1. Promptolis, "Comprehensive Repository Audit & Remediation Prompt"
   - URL: https://promptolis.com/prompts/comprehensive-repository-audit-remediation-prompt/
   - Used for: repository assessment structure, dependency/build/CI review, systematic bug categories, and the requirement that findings include severity, reproduction path, impact, and concrete fixes.
   - Adaptation: the original remediation-heavy framing was narrowed to audit-only per LaserForge rules. No production fixes were performed.

2. Chris Lema, "Code Audit Prompt"
   - URL: https://chrislema.com/code-audit-prompt/
   - Used for: insisting on specific file paths, line numbers, evidence, and concrete suggested fixes rather than summaries.
   - Adaptation: the generic structural checklist was specialized toward LaserForge's scene/job/output/device boundaries, serial control paths, and laser-safety behavior.

3. OWASP Code Review Guide
   - URL: https://owasp.org/www-project-code-review-guide/
   - Used for: manual review emphasis alongside tool output. The audit treats automated scans as leads, not proof.

4. OWASP Desktop App Security Top 10
   - URL: https://owasp.org/www-project-desktop-app-security-top-10/
   - Used for: desktop-specific framing around poor code quality, insecure communication, security misconfiguration, and logging/monitoring.

5. Electron Security Checklist
   - URL: https://www.electronjs.org/docs/latest/tutorial/security
   - Used for: Electron-specific review of renderer isolation, CSP, custom protocol behavior, permissions, and main-process coverage.

## Local Rules Applied First

LaserForge's local rules override the generic prompts:

- `CLAUDE.md` requires audit-only reporting unless the maintainer asks for fixes.
- `PROJECT.md` defines laser-safety non-negotiables.
- `WORKFLOW.md` defines expected user-visible behavior.
- `DECISIONS.md` defines architecture and dependency policy.
- `AUDIT.md` is the existing rolling audit baseline for the new repo.

The old-repo paths from `AGENTS.md` (`docs/AUDIT.md`, `.cursor/rules/laserforge.md`) do not exist in `LaserForge-2.0`; the root-level equivalents above were used instead.
