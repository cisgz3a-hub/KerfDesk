## ADR-524 Amendment 4 - The pages read as if Pro is on sale, with one "launches soon" line until sales open (2026-09-30)

> **Reconciliation (8 October 2026):** This earlier copy and generator plan is superseded by [publishing notes](../legal/publishing-notes.md) and main PR #1083. Current public pages state the actual closed-sales and trial status; the default generator writes local drafts, and public information is checked separately with --public-info. The original decision is retained below as history.

**Status:** Superseded | **Date:** 2026-09-30 | **Amends:** ADR-524 Amendment 2 decision 2,
ADR-524 Amendment 3

### Context

On 2026-09-29 the owner asked for the customer texts to be written as launch versions: "I also
noticed you word it like after pro features go live. This will only go live in the end so why talk
as if you mention stuff that will come". The legal texts are being rewritten that way. The
download page still said "Once sales open, buy or renew from Help > Licence inside the app", and
the product website said "Purchase opens soon" and that the trial starts "once the desktop app is
released" on its home, FAQ, About and download pages (ADR-524 Amendment 2 decision 2). Asked
whether to reword them as if Pro is on sale, with one "KerfDesk Pro launches soon" line at the
top until launch day, the owner chose **Reword them** (2026-09-29, 23:57 UTC).

### Decision

1. **The pages say what KerfDesk does, not what it will do.** The website's home, FAQ, About and
   download pages describe the trial and the licence in the present tense, and the FAQ says Pro
   is bought in the desktop app, from Help > Licence. The download page says to buy Pro, or
   another year of updates, from Help > Licence inside the app. When the download catalogue has no
   licensed release, the page says there is none to download right now.
2. **One line says Pro launches soon.** Until `salesOpen` in `website/commerce.config.mjs` is
   true, every page of the website, every page `scripts/generate-site-pages.mjs` writes (pricing,
   terms, privacy, refunds, PAIA manual, licence and notices, machines, safety) and
   `public/download.html` opens with the one line "KerfDesk Pro launches soon." above the header.
   The generator keeps the download page's line between its two `launch-note` markers. Setting
   `salesOpen` and running `pnpm generate:site-pages` removes the line everywhere, in the change
   that opens sales. The line stays out of the legal texts themselves, because the installer shows
   the licence agreement word for word.
3. `trialOpen` no longer changes any wording. It still has to be true before sales can open.

### Consequences

- `website/tests/commerce.test.mjs` and `scripts/generate-site-pages.test.mjs` check that every
  page shows the line exactly once while sales are closed, and that no website page says purchase
  opens later.
- The pricing page's own text is a legal text; its launch version arrives with the other revised
  texts.
- Nothing deploys the website automatically (ADR-524), so its change reaches no one until it is
  published. The app's pages go live with this pull request's merge.
