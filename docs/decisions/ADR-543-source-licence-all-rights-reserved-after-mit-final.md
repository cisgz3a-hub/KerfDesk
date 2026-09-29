## ADR-543 - KerfDesk's own work is all rights reserved after the `mit-final` cutoff (2026-09-29)

**Status:** Accepted by the maintainer on 2026-09-29 ("Let's do it", 05:29 UTC). It takes effect
when the commit that adds this file lands on `main`. The cutoff commit and the `mit-final` tag are
recorded below after that merge.
**Amends:** ADR-120 (the MIT licence and the installer notice it set for ADR-114), ADR-247 §1
and §2 (the MIT baseline and the boundary requirements), and ADR-523's statement that `LICENSE`
remains unchanged (ADR-523 is in PR #1018 and not yet on `main`).

### Context

ADR-120 released KerfDesk under the MIT License on 2026-07-07. ADR-247 kept that baseline and set
the conditions for any later boundary: a new ADR with the exact cutoff commit and date, a final
annotated MIT tag, contributor rights, and aligned `LICENSE`, `package.json`, `CONTRIBUTING.md`,
EULA and notices, and release copy. The maintainer now plans paid Pro licences (ADR-523).

Every version published under the MIT License stays MIT for anyone who received it, and a later
notice cannot withdraw that (ADR-247). That covers all code on `main` up to the cutoff, including
every tool now planned as Pro, and every commit pushed to another public branch while it still
carried the MIT `LICENSE`, such as the licensing code in PRs #1018 and #1021. Rewriting that code
would not change this: the copies already out stay MIT whatever replaces them. What a cutoff can
protect is work first published after it, plus official builds, updates and support.

### Decision

1. **Cutoff.** The cutoff commit is the last commit on `main` before this change: the parent of
   the commit that brings this ADR to `main` (its first parent, if that is a merge commit). It and
   everything before it on `main` stay under the MIT License. After the merge the maintainer tags
   it:
   `git tag -a mit-final -m "Last KerfDesk version released under the MIT License" <sha>` and
   `git push origin mit-final`. The name matches neither release workflow's tag filter
   (`v*-preview.*` in `release-desktop-preview.yml`, `v*` in `release-desktop-stable.yml`), so
   pushing it starts no release. Other public branches leave MIT when they take in this change;
   their earlier pushes stay MIT for anyone who received them.
2. **The new licence.** `LICENSE` reserves all rights for Johann Stolk, the holder the MIT
   `LICENSE` named. It points app users to the terms that come with the app, says versions up to
   and including `mit-final` stay MIT, keeps third-party licences, and notes that GitHub's terms let
   users view and fork a public repository on GitHub without any further right. The unchanged MIT
   text moves to `LICENSE-MIT`. `package.json` declares `"license": "SEE LICENSE IN LICENSE"`,
   npm's form for custom terms, and its description drops "MIT licensed.".
3. **Free use, except Pro.** `public/eula.txt` §1 replaces the MIT grant with a free licence to
   install and use the app for personal or business work. That free use does not cover features
   the app marks as Pro, which need an active trial or a paid licence under the KerfDesk Licence
   Agreement (ADR-523), and the notice forbids bypassing or disabling the licence checks. It keeps
   the usual limits on selling, redistributing, hosting for others and reverse engineering,
   "except as the law allows". Its safety, warranty and liability sections are unchanged. A
   commercial build supplied with the KerfDesk Licence Agreement is governed by that agreement
   instead. The About dialog names the notice as the terms of use; the Help safety notice,
   `docs/safety.md`, the NSIS config comment and the notices headers point to it too. The Pro
   exception was written in on 2026-09-29, after the maintainer asked whether "free to use" meant
   nothing could be sold: the free licence covers the Free tier only, and Pro stays paid.
4. **Not open source.** While the repository is public its source is visible but all rights
   reserved. It must not be described as open source (ADR-247 §2). Whether it stays public is the
   maintainer's separate choice. Making it private stops new work from being published; it does
   not undo MIT for anything already published, cloned or forked.
5. **What keeps its own licence.** Third-party code, fonts, artwork and test fixtures keep their
   licences and notices. Design-library artwork authored for KerfDesk keeps the per-entry MIT label
   in `src/ui/library/design-library-owned-svg.ts`, so people may keep using it in their own
   designs; `LICENSE` excepts any file or component that states its own licence.
6. **Contributor rights.** The full history of `main` (2,842 commits on 2026-09-29) has three
   authors: `cisgz3a-hub` (2,477 commits), Claude (232) and "Johann"
   `<stolk.johann.johann@gmail.com>` (133, 2026-05-29 to 2026-07-08, the GitHub account
   `stolkjohannjohann-sudo`). Co-author trailers name only Claude models and "Johann". The
   maintainer confirmed on 2026-09-29 that `stolkjohannjohann-sudo` is his own older account ("the
   older Github account is an old repo I built and not using anymore"). There is no outside
   contributor to ask. Claude and Codex wrote code at the maintainer's direction. No lawyer has
   reviewed this. For ADR-247 §2's contributor-rights condition, this audit and the maintainer's
   confirmation stand in now, and a lawyer's review follows before the first sale; the draft
   `docs/legal/lawyer-review-notes.md` (PR #1021) already lists the AI-output question for it.
   From now on, `CONTRIBUTING.md` accepts a contribution from anyone else only under a signed
   agreement that assigns or licenses it to the copyright holder.
7. **Release metadata.** The Preview CycloneDX SBOM names the KerfDesk component's licence instead
   of claiming `MIT`. The stable-lane SPDX SBOM reports `NOASSERTION` for npm's `SEE LICENSE IN` and
   `UNLICENSED` forms, which are not SPDX expressions. The packaged About check and the Windows
   installer description check follow the new wording.
8. **ADR-523.** Its "`LICENSE` remains unchanged" no longer holds; `LICENSE` follows this ADR.
   Its commercial runtime decisions under ADR-247 §3 are untouched.

### Consequences

- Everything on `main` up to the cutoff, and everything pushed to a public branch under the MIT
  `LICENSE`, remains MIT for its recipients. The paid licence cannot make those copies exclusive.
- Work first published after the cutoff is all rights reserved. Every public branch still carrying
  the MIT `LICENSE` keeps publishing under MIT until it takes in this change, so this ADR should
  land before other open work, and each open branch should merge `main` before its next push.
- MIT tags, releases and Preview downloads keep their MIT notices and are not deleted.
- `docs/legal/kerfdesk-licence-agreement.md` §16.2 (PR #1021) can fill its relicensing
  placeholder from the cutoff record below.

### Cutoff record

- Cutoff commit (last MIT commit on `main`): to be recorded after merge.
- Date of the change on `main`: to be recorded after merge.
- `mit-final` annotated tag: to be created by the maintainer on the cutoff commit.

### Verification

- `node scripts/check-adr-numbers.mjs`, `pnpm license-check`, `pnpm test:release-integrity`,
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and the affected Vitest suites pass.
- `pnpm licenses list --prod --json` does not list the root package, so the licence gate is
  unaffected by the root's new `license` value.
- `public/third-party-notices.txt` is regenerated from `scripts/generate-third-party-notices.mjs`.
- `git grep` finds no first-party MIT or open-source claim outside history records (ADRs, dated
  audits and proposals) and third-party attributions.

### References

- GitHub Terms of Service, D.5 "License Grant to Other Users":
  https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- choosealicense.com, "No License": https://choosealicense.com/no-permission/
- npm, `package.json` `license`: https://docs.npmjs.com/cli/v11/configuring-npm/package-json#license
- SPDX 2.3, declared licence values: https://spdx.github.io/spdx-spec/v2.3/package-information/
- CycloneDX 1.6 licence choice: https://cyclonedx.org/docs/1.6/json/
- Open Source Definition: https://opensource.org/osd
