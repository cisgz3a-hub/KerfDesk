## ADR-544 - Licence bypass defences: close the free doors, refuse remote debugging, accept what no licence can stop (2026-09-29)

**Status:** Accepted; the free-build switch stays off until sales open | **Date:** 2026-09-29 | **Amends:** ADR-540 item 6

### Context

On 2026-09-29 the owner asked that his licence be safe and that people should not
be able to bypass it, backed by research. The research compared KerfDesk's
licensing (ADR-523, ADR-523 Amendment 1, ADR-540) with how Electron apps are
cracked and how comparable products protect themselves.

The licence core holds up. Entitlements are Ed25519-signed and checked against
pinned keys, so a fake licence server fails. A licence is bound to a
product-specific hash of the Windows installation and stored with safeStorage, so
copying it to another computer fails. The server enforces three seats, limits
seat moves, revokes, and refreshes weekly. The packaged app sets every Electron
fuse, loads only its integrity-checked `app.asar`, disables DevTools and ships
without source maps.

The research found four weaker places:

1. **Free builds hold every Pro tool.** The web app, Preview and other free
   desktop builds have no licence adapter, so ADR-540 item 6 lets them open every
   Pro tool. Once Pro is sold, "use the free version" would be the easiest bypass.
2. **Remote debugging.** Chromium's `--remote-debugging-port` and
   `--remote-debugging-pipe` switches let Chrome DevTools attach to the renderer
   of a signed, fused build. No Electron fuse covers them
   ([Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses); a
   fuse was [requested](https://github.com/electron/fuses/issues/2), status
   unverified), and the repository's own installed-app checks drive packaged
   Preview builds this way.
3. **The commercial package has not been checked for its fuses or tamper
   refusal.** Only the Windows Preview has proven them (ADR-522).
4. **The source is public under MIT.** ADR-543 draws the licence cutoff; making
   the repository private is the owner's step.

### Decision

1. **Free builds run KerfDesk Free once sales open.** `UNLICENSED_BUILDS_RUN_FREE`
   in `src/ui/licensing/edition-policy.ts` makes the web app and every desktop
   build without commercial metadata lock the Pro tools. Their Pro dialog points
   to the desktop app ("Get KerfDesk Pro", `https://kerfdesk.com/download.html`)
   instead of offering a trial or a key. A free desktop build's reported
   `edition: 'pro'` is read as Free, including for a Pro tool asked for before the
   status arrives. The switch stays `false` until the launch change that enables
   checkout, because nobody can buy Pro before then and the owner runs his
   machines on these builds. This replaces ADR-540 item 6's "until web licensing
   ships".
2. **A packaged build that sells licences refuses remote debugging.**
   `electron/debug-switch-policy.ts` checks `--remote-debugging-port`,
   `--remote-debugging-pipe` and every other `remote-debugging` switch spelling
   Chromium accepts (`-`, and `/` on Windows, in any case) before any window,
   route or single-instance handoff. KerfDesk then shows one message and exits.
   Malformed licensing metadata counts as selling licences. Preview, free and
   development builds keep the switches.
3. **The commercial release checks its own package.** The release train
   (ADR-541) reads the packaged executable's fuses and runs the ASAR tamper test
   on the commercial package before anything is published, as ADR-522 does for
   the Preview.
4. **Pro work after the licence cutoff stays private** (ADR-543, with the owner
   making the repository private).

### What is accepted

No licence check on the customer's computer is unbreakable, as ADR-523 already
says. The research confirmed it:

- KerfDesk installs per user, so its files can be changed without administrator
  rights. The fuses are bits in the executable and the ASAR hash is a resource
  inside it ([Electron ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)).
  Integrity checks have been bypassed in signed Electron apps through files they
  did not cover (CVE-2025-55305,
  [Trail of Bits](https://blog.trailofbits.com/2025/09/03/subverting-code-integrity-checks-to-locally-backdoor-signal-1password-slack-and-more/)).
- LightBurn, whose model this follows, is still pirated
  ([LightBurn licence management](https://docs.lightburnsoftware.com/2.2/Reference/LicenseManagement/),
  [forum](https://forum.lightburnsoftware.com/t/hacked-version-of-lightburn/108336)).
- An activated computer kept offline keeps its signed rights until it reconnects,
  so a refund or revocation reaches it only then. KerfDesk keeps offline use:
  workshop computers are often offline. A required check-in (Fusion asks about
  every two weeks,
  [Autodesk](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Is-it-possible-to-work-in-Offline-Mode-permanently-in-Fusion-360.html))
  needs the owner's decision.
- A new Windows installation gets a new trial.
- Project files are not signed, and Free runs Pro operations saved in a project
  (ADR-540 item 3), so a project edited by hand can carry one.
- Planned web licensing (ADR-540 item 7) cannot be protected like the desktop:
  every browser lets its user open developer tools. It waits for the owner's
  decision; after launch the browser stays Free.

The goal is that paying is the easiest path, casual sharing fails and leaked keys
can be revoked. Signed updates, support and the terms carry the value.

### Rejected

- **Obfuscation or V8 bytecode.** The Pro tools run in the sandboxed renderer,
  which electron-vite's bytecode protection does not cover, and its own guide says
  no client-side protection is absolute
  ([electron-vite](https://electron-vite.org/guide/source-code-protection)).
- **A native licence module.** The JavaScript that calls it is patched instead.
- **Moving the Pro check into the main process.** With remote debugging refused,
  reaching the renderer needs the same executable patch that reaches main.
- **Computing Pro features on a server.** It is the only uncrackable option (Easel
  Pro is a signed-in web membership), but it ends offline use and breaks
  ADR-523's promise that no project data is uploaded.
- **Anti-debugging, self-checksums and per-buyer watermarks.** The patch that
  unlocks Pro removes them too.

### Later, when abuse shows

- Flag one activation refreshing from many networks, and many trials from one
  network, then revoke. Both need a privacy notice update first.
- Honour Pro operations only in projects saved on a Pro or trial device.

### Consequences

- The launch change sets `UNLICENSED_BUILDS_RUN_FREE = true` together with
  enabling checkout (`docs/desktop-commercial-launch.md`).
- `EditionProvider` takes `unlicensedRunsFree`; tests pass it explicitly.
- A support engineer cannot attach DevTools to a customer's commercial build.
  Diagnostics come from the app itself.
- This decision operates no machine and changes no output. Frame remains the sole
  ordinary Start gate.
