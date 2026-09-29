## ADR-247 Amendment 1 - The maintainer's approved Pro licence, and the rules it leaves in place (2026-09-29)

**Status:** Accepted | **Date:** 2026-09-29 | **Amends:** ADR-247 §3

### Context

ADR-247 §3 authorized no account, trial, activation, device binding, paywall or entitlement
network call. It allowed one later only with the maintainer's explicit prior permission and a
coordinated supersession of the no-new-guard rule in `AGENTS.md`, `CLAUDE.md`, PROJECT
non-negotiable 21 and ADR-228 where applicable, and said an ADR alone could not authorize it.

ADR-523 (2026-09-28) and ADR-540 (2026-09-29) then built the commercial desktop channel: a licence
service, a 30-day trial per device, activation on three computers, and a Pro check on eight tools.
ADR-543 changed the source licence. None of them updated the agent rules or PROJECT to match:
PROJECT's out-of-scope list still named activation, entitlement, trials, device binding and
paywalls, and its description of the operator still had ADR-523's admission screen, which ADR-540
removed.

### Decision

1. **The permission.** The maintainer asked for the commercial desktop channel: private-source
   distribution, public downloads, a full trial, perpetual licences and paid update renewals
   (ADR-523, 2026-09-28). He approved the Free and Pro split and Pro in the desktop app only
   (ADR-540, 2026-09-29), and asked on 2026-09-29 that his licence be safe from being bypassed
   (ADR-544).
2. **The no-new-guard rule stays.** That rule is about Start: a completed Frame for the exact job
   is the sole ordinary Start gate (`AGENTS.md`, PROJECT non-negotiable 21, ADRs 228, 230 and 232).
   The Pro check never gates Frame, Start, output, Save G-code or a running job (ADR-540 item 3),
   so it is not a Start guard. The rule and ADR-228 are kept, not superseded.
3. **What is superseded** is PROJECT's out-of-scope entry, for the commercial desktop channel only.
   Accounts, cloud, sync, subscriptions and any other licence or entitlement check stay out of
   scope.
4. **The coordinated edits.** `AGENTS.md` says the Pro licence check is the only licence gate,
   that it is not a Start guard, and that any other account, trial, activation or entitlement
   check needs the maintainer's explicit permission and an ADR. `CLAUDE.md` defers to `AGENTS.md`
   and is unchanged. PROJECT's operator description follows ADR-540, non-negotiable 21 says the
   Pro check is not a Start guard, and its out-of-scope entry names the channel as the exception.

### Consequences

- Work on the licence service, the trial and the Pro check stays within ADR-523, ADR-540 and
  their amendments.
- A new gate of any kind, or a licence check anywhere near Frame, Start or output, still needs the
  maintainer's explicit permission and its own ADR.
