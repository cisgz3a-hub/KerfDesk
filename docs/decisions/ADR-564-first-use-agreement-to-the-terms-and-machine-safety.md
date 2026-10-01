## ADR-564 - KerfDesk asks once, when it first opens, for agreement to the terms and to machine safety (2026-09-29)

**Status:** Accepted | **Date:** 2026-09-29
**Relates to:** ADR-247 Amendment 2 (the owner's legal texts), ADR-524 Amendment 3 (the pages),
ADR-228 and PROJECT non-negotiable 21 (Frame is the only Start guard), ADR-247 decision 3 and
AGENTS.md (no commercialization gate)

### Context

The owner is publishing the terms that the sourced legal review checked (ADR-247 Amendment 2).
They say how a user accepts them: "You accept these terms when you tick the box or click “I
agree” to accept them, for example in the desktop installer, when you first open the web app, or
before you buy. We also ask you to confirm separately that you have read the machine-safety
section (section 2)" (terms 1.3). Section 2.5 repeats that the confirmation comes "before you
first use KerfDesk". A later change that reduces users' rights "applies to you only once you agree
to it ... and KerfDesk will ask you to agree. If you do not agree, the terms you agreed to before
keep applying to you" (24.3). The review found that without these steps the safety
acknowledgement, the disclaimers and the liability limits probably do not bind anyone, and its
publishing notes ask for an ADR that squares the step with ADR-228 and ADR-247 decision 3.

The checkout page already asks before Paddle's checkout opens (ADR-524 Amendment 3). The web app
and the desktop app asked nothing.

### Decision

1. **The first time KerfDesk opens, it asks before anything else starts.** A dialog, "Before you
   use KerfDesk", names the seller, links the Terms of Service and the Privacy Notice, and shows
   section 2 of the terms in full. It has two separate ticks, the same as the checkout page's:
   "I have read and agree to the Terms of Service, and I have read the Privacy Notice" and "I have
   read the machine-safety section of the terms (section 2), understand the risks, and will
   operate my machine safely". **Agree and continue** works once both are ticked. The dialog has
   no Close; its last line says "If you do not agree, close KerfDesk and do not use it." Until it
   is answered, none of the app mounts: no project opens, no machine can be connected, no licence
   is checked and no other prompt appears. Closing the desktop window at this point closes it at
   once, because nothing can be running or unsaved.
2. **The answer is kept on the device and never sent anywhere.** The browser's or the desktop
   app's storage keeps the terms version agreed to and the time (`kerfdesk.terms-agreement.v1`),
   like the other settings. KerfDesk has no accounts, so the seller keeps no copy; the privacy
   notice's section 3.2 names it among the working data that stays on the user's computer.
3. **A new version asks again only when it reduces users' rights.** `AGREEMENT_COVERS_FROM` names
   the oldest version whose agreement still counts; whoever publishes a change that reduces users'
   rights raises it to the new version. The app then offers the new version once, over the open
   app: **I agree to the new terms** or **Keep my earlier terms**. Either answer is remembered, and
   keeping the earlier terms locks nothing. Any other change applies from its publication, with no
   question.
4. **The step starts with publication.** The app reads the version, the publication date and
   section 2 from `docs/legal/kerfdesk-licence-agreement.md` through a generated module
   (`src/ui/legal/terms-text.generated.ts`, written by `pnpm generate:site-pages`, which fails its
   test when stale). While the publication date is still a blank, the terms are not out, and
   nothing is asked.
5. **Automated browsers are not asked.** A browser that reports automation
   (`navigator.webdriver`: tests, monitoring) is not a person who could agree. The packaged desktop
   smoke, which runs on a new profile, ticks both boxes and agrees as a new user would, and reports
   that it did.

### Why this is not a guard

- **It is not a Start guard (ADR-228, non-negotiable 21).** It appears only while KerfDesk opens,
  before a machine can be connected, and once answered on a device it does not appear again. It
  never gates Frame, Start, output, Save G-code or a running job, and it never appears during a
  job. The later offer of 3. is shown over the open app and blocks nothing. A completed Frame
  remains the only Start policy gate.
- **It is not a commercialization gate (ADR-247 decision 3, AGENTS.md).** It is no account,
  trial, lease, activation, subscription, device binding, paywall or entitlement, and it makes no
  network call. Free and Pro, and every tool in them, work the same after it as before.
- **It is what the owner's own terms describe.** The owner chose to publish these terms (ADR-247
  Amendment 2). The step is how a user accepts them, and it goes live with them, in the same
  merge.

### Consequences

- Everyone who opens a version released after the terms are published is asked once, including
  existing users, because those versions come under the new terms (terms 1.7).
- The desktop installer still shows `public/eula.txt`, which the owner has not yet approved
  replacing (AGENTS.md); its "I agree" to the new terms follows with that replacement.
- Clearing the site data, or a new computer, asks again.

### Alternatives considered

- **Show the dialog over the running app.** Rejected: the app's own opening prompts (a restored
  project, an interrupted job, the desktop offer) would stack under or over it, and its shortcuts
  and machine controls would be live before the user had agreed.
- **Link section 2 instead of showing it.** Rejected: the desktop app works offline, and the user
  confirms having read the section.
- **Record agreements on a server.** Rejected: it would need an account or a device identifier
  and a network call, and the privacy notice promises no accounts and no tracking (its section 2).
