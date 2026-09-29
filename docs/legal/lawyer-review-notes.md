# KerfDesk legal documents: lawyer review notes

> **Internal working notes. Not legal advice. Do not publish.** Claude (an AI assistant) prepared
> these notes and the three customer documents at John's request. Claude is not a lawyer. Items
> marked **check** are points where Claude is unsure of the law or how it applies; a qualified
> lawyer should decide them.

Documents covered, all in `docs/legal/`: `kerfdesk-licence-agreement.md` ("the agreement", cited
as §), `kerfdesk-refund-policy.md` and `kerfdesk-privacy-notice.md`. Prepared 29 September 2026.

## Before sales open

1. A South African lawyer checks section A1, especially the CPA and ECTA items.
2. A US lawyer checks section A2.
3. John fills in the placeholders (section E) and settles the MIT question (section D).
4. The app, website and licensing service are made to match the promises listed in section F.

## A. Clauses to check, and the law that may override or require wording

### A1. South Africa

1. **Does the CPA reach these sales, and who is the "supplier"?** (§1, §14, §21) The Consumer
   Protection Act 68 of 2008 applies to transactions in South Africa (s5), not to juristic persons
   at or above the turnover or asset threshold (s5(2)(b)). With Paddle as reseller and merchant of
   record, is John a "supplier", "producer" or "distributor" to the end customer, and does the CPA
   reach foreign buyers at all? The answer sets how much of this list matters. **check**
2. **Software is probably "goods".** The CPA's definition of "goods" (s1) appears to include
   software and a licence to use it. If so, the quality and product-liability rules below apply to
   KerfDesk sold to South African consumers. **check**
3. **s49 notice and specific assent.** (§10 safety, §11, §12, §13 indemnity) Terms that limit the
   supplier's risk, make the consumer assume risk, require an indemnity or record an acknowledgement
   must be drawn to the consumer's attention conspicuously and in plain language, before the
   agreement is made or payment is taken (s49(1), (3) to (5)). A risk that could cause serious
   injury or death must be pointed out specifically, and the consumer must assent by signing,
   initialling or an equivalent act (s49(2)). Lasers and CNC machines qualify. Recommendation: an
   unticked checkbox, separate from general acceptance, at checkout and at first run: "I have read
   sections 10 to 13 (machine safety, no warranty, liability and indemnity) and accept them."
   Check whether that satisfies s49(2) electronically.
4. **s48 and s51, unfair and prohibited terms.** (§8.2, §8.6, §12, §13, §17.5, §19.2, §21.2)
   s51(1)(c) forbids excluding liability for gross negligence, so §12 carves it out. Check the
   12-month/US$50 cap, the exclusion of property damage, unilateral changes (§17.5), termination on
   notice (§19.2) and the 30-day step before court (§21.2) against s48, and against the terms that
   regulation 44 of the CPA Regulations presumes unfair. As Claude understands it, that list
   includes limiting liability for death or personal injury. If so, §12's carve-out for personal
   injury should apply without the words "where the law requires". **check**
5. **s55 and s56, implied warranty of quality.** (§11, §14) Consumers are entitled to goods of good
   quality that are usable and durable, and may return defective goods within six months for
   repair, replacement or refund, at the consumer's choice (s56(2)). §11's "as is" cannot remove
   this where the CPA applies; §14 preserves it. Check whether s55(6) (goods offered in a stated
   condition and expressly accepted in it) can be met through the free 30-day trial and §11's
   plain-words paragraph.
6. **s61, strict product liability.** (§10, §12, §14) Producers, importers, distributors and
   retailers are liable for harm caused by unsafe goods, a product failure, defect or hazard,
   including damage to property, without proof of negligence, subject to the defences in s61(4). If
   software is goods, a toolpath bug that starts a fire could fall here, and a contract cannot
   exclude it. Check the exposure and consider product-liability insurance.
7. **s22 plain language, and s50 copies.** Check that the sections in capitals still meet the
   plain-language standard, and that customers can keep a copy (§22 offers download).
8. **s14 fixed-term agreements.** This is probably not triggered: the licence is perpetual, nothing
   is billed on an ongoing basis, and each extension is a single optional purchase (§5). **check**
9. **Minors.** (§1.4) Check the 18+ rule against the common law on minors' contracts and any CPA
   provision on persons without legal capacity.
10. **ECTA s43, information a website seller must show.** (§24, refund policy, privacy notice,
    checkout) The Electronic Communications and Transactions Act 25 of 2002 requires, among other
    things: full name and legal status; physical address and **telephone number**; website and
    **email address**; registration number and office bearers if a legal person; an address for
    service of legal documents; the main characteristics of the product; the full price including
    taxes; payment method; the terms and how to access and store them; delivery time; the return,
    exchange and refund policy; and security procedures and privacy policy. The telephone number
    does not exist yet (a placeholder in §24); the email address is support@kerfdesk.com. s43(2) requires a chance to review,
    correct and withdraw before ordering (check Paddle's checkout). Under s43(3), if these are
    missing, the consumer may cancel within 14 days. Check whether John or Paddle is the "supplier"
    for s43; the safest course is for kerfdesk.com to show everything anyway.
11. **ECTA s44 cooling-off.** (§8) Consumers may cancel without reason within seven days. As Claude
    understands s42(2), the exemptions include services that began with the consumer's consent
    within the seven days, and computer software "unsealed" by the consumer; check the wording and
    whether it covers downloads. The 14-day no-reason refund in §8.1 is meant to exceed s44 anyway.
    s47 applies these protections whatever law the agreement chooses, and s48 voids any term that
    excludes them; §14 and §21.4 are written to fit.
12. **ECTA electronic agreements.** (§1.2, §22) Check the clickwrap flow against the rules on
    agreements made by data message and incorporation by reference (s11(3), s22), including the
    linked privacy notice, refund policy and Paddle buyer terms.
13. **POPIA.** (privacy notice; §15) Protection of Personal Information Act 4 of 2013. Check the
    s18 notification content; registration of the Information Officer with the Information
    Regulator (placeholder); cross-border transfers to Cloudflare and Paddle (s72); a written
    operator agreement with Cloudflare (s21, probably its standard data processing terms); the
    retention periods (s14): 90 days for deactivated devices and 3 years for trial records; and
    treating the installation digest as personal information (a unique identifier). The notice
    promises breach notification (s22).
14. **Tax records.** (privacy notice) Check the five-year period in the Tax Administration Act 28
    of 2011 (s29), and ask an accountant about income tax on Paddle payouts and whether VAT
    registration is needed.
15. **Courts and redress.** (§21) Check whether to name a High Court division or consent to
    Magistrates' Court jurisdiction, and that §21.2 does not obstruct a consumer's other routes
    under the CPA (s69: ombud, National Consumer Commission, consumer court).
16. **Indemnity.** (§13) It excludes consumers, but small juristic persons below the CPA threshold
    are still "consumers" under the CPA. Check §13 against s49(1) notice and s48 fairness.

### A2. United States

1. **Warranty disclaimer form.** (§11) Under UCC §2-316, excluding the implied warranty of
   merchantability must mention merchantability and, if written, be conspicuous; excluding fitness
   must be written and conspicuous; "as is" and "with all faults" exclude implied warranties. §11
   is set in bold capitals for this reason. Whether Article 2 applies to software licences differs
   between states; the wording aims to satisfy it either way. **check**
2. **Magnuson-Moss Warranty Act.** A seller who gives a "written warranty" on a consumer product
   may not disclaim implied warranties (15 U.S.C. §2308). The terms give no written warranty; the
   14-day refund is a satisfaction refund, not a warranty. Check that no website or app statement
   reads as one (UCC §2-313 express warranties), and whether downloaded software is a "consumer
   product" at all.
3. **State limits on disclaimers.** Some states restrict "as is" sales of consumer goods (for
   example Massachusetts and Maryland; check the full list and whether software is covered). §11
   ("to the fullest extent the law allows") and §14 are written to give way.
4. **Personal injury.** Under UCC §2-719(3), limiting consequential damages for injury to the person
   in consumer goods is prima facie unconscionable. Consider making §12's personal-injury carve-out
   unconditional (see also A1.4).
5. **Unfair or deceptive practices** (FTC Act s5 and state UDAP laws). "Perpetual", "Free has no
   time limit", "not a subscription" and "3 devices" must all be true in the app (section F). The
   web-app limit after the update end date (§4.6) must be shown before purchase, on the pricing
   page and at checkout.
6. **Automatic-renewal laws** (for example California Business and Professions Code §17600 and
   following, similar state laws, and FTC negative-option rules). They are not triggered, because
   nothing renews or charges automatically (§5.4). Check that the Paddle catalogue has no
   recurring price and that no payment method is saved for later charges; the licensing README
   specifies one-time prices with no recurring billing.
7. **Clickwrap.** (§1.2, §22) US courts enforce online terms when the notice is reasonably
   conspicuous and the user clearly shows assent (for example Meyer v. Uber, 2d Cir. 2017; Berman
   v. Freedom Financial Network, 9th Cir. 2022; check citations). Use an unticked box or an "I
   agree" button with the terms linked beside it, in the installer, at first run of the web app and
   at checkout. Do not rely on "by using" alone (browsewrap), especially for Free web users. Record
   which terms version was accepted.
8. **Choice of law and forum against consumers.** (§21) Some states will not enforce a foreign law
   or forum clause against their consumers; §21.4 accepts that. No arbitration clause or class
   action waiver was included (section B). Check whether that is the right trade-off for US sales.
9. **Unilateral changes.** (§17.5) New terms bind only with notice and assent. They are drafted to
   apply to new versions (accepted on install), with 14 days' notice for the web app. **check**
10. **Export controls.** (§20) Check whether the EAR applies at all (software developed outside
    the US, US content below the de minimis level, MIT versions already published) and, if it does,
    the classification (probably EAR99 or 5D992.c mass-market, because the app uses standard
    encryption for HTTPS and signatures). Also check that no feature falls under numerical-control
    controls. As Claude understands it, ECCN 2D002 concerns software that lets a device act as a
    numerical-control unit coordinating more than four axes for contouring; KerfDesk drives
    three-axis and rotary machines. Check South African export control law too. Paddle screens
    orders for sanctions.
11. **Sales tax.** Paddle collects and remits as merchant of record. Check that the "plus
    applicable tax" wording on the pricing and download pages matches Paddle's setup.
12. **Privacy.** Check that state privacy laws such as the CCPA/CPRA do not apply (their revenue
    and data thresholds are likely not met), and that COPPA does not (KerfDesk is not aimed at
    children).

### A3. Other buyers, and Paddle

1. **EU and UK consumers.** They have a 14-day right to withdraw from digital content purchases.
   It is lost if they agree to immediate supply and acknowledge the loss (Consumer Rights
   Directive art. 16(m); UK Consumer Contracts Regulations 2013 reg. 37). Paddle's checkout and
   buyer terms handle this, and §8.1 gives 14 days to everyone. UK and EU law also forbid excluding
   liability for death or personal injury caused by negligence (§12 carve-out).
2. **GDPR.** It applies when goods are offered to people in the EU or UK (art. 3(2)). A
   representative under art. 27 may be needed unless the exemption for occasional, low-risk
   processing applies. **check**
3. **Paddle approval.** Once approved, confirm: the Paddle entity name (§7.1); the buyer terms URL
   (https://www.paddle.com/legal/checkout-buyer-terms) and privacy URL
   (https://www.paddle.com/legal/privacy); that Paddle accepts the refund policy; and anything
   Paddle's website review requires in the seller's terms. **check**

## B. Decisions made on open points

- **Seller:** Johann Stolk as a sole proprietor trading as KerfDesk. Company or trading details are
  placeholders.
- **Version and date:** version 1.0, dated 29 September 2026, in force from the day sales open.
- **URLs:** agreement at https://kerfdesk.com/terms/, refund policy at /refunds/, privacy notice as
  a section of /privacy/, Free/Pro split at /pricing/, support at /support.html.
- **Transfer:** not transferable without our written consent. Whole-licence transfers are
  considered on request (the draft's option, narrowed).
- **Organisations:** a licence belongs to the buyer. An organisation's staff and contractors may
  use it within 3 devices.
- **Lost devices:** support may deactivate them after reasonable checks and refuse requests that
  look like abuse.
- **Refunds:** 14 days, no reason needed, for licences and extensions. After that, only where the
  law requires, for a double or wrong charge, or when a licence cannot be made to work. The full
  30-day trial makes a longer window unnecessary. Fourteen days meets or beats EU/UK withdrawal
  rights and ECTA's seven days, fits Paddle's buyer terms, and cuts chargebacks.
- **After a refund:** the licence ends, or the extension year is removed. The customer must
  deactivate. We may block the key. Remote revocation of offline copies is not promised.
- **Chargebacks:** the licence may be suspended during a dispute and ends if the payment is
  reversed.
- **Extension dates:** the year is added to the current update end date, or runs from the payment
  date if updates have lapsed. This matches `nextUpdateYear(Math.max(now, updatesUntil))` in
  `services/desktop-licensing/payments.mjs`.
- **Web app:** it has the Free features only, because Pro is desktop only (the owner's choice of
  29 September 2026, ADR-540 item 7), so the update end date matters only in the desktop app.
  Covered desktop versions keep Pro.
- **Downloads:** covered desktop versions stay downloadable while the download service runs.
- **Licensing shutdown:** we promise reasonable efforts to let covered versions activate on new
  devices.
- **Free/Pro changes:** Pro to Free at any time. No move from Free to Pro, and no removal, in
  released versions. The listed Free features stay Free in future versions.
- **Restrictions:** no redistribution of copies, even unchanged; people are pointed to
  kerfdesk.com instead, which also protects users from tampered builds that drive machines.
  Reverse engineering is allowed only as the law or an open-source licence allows.
- **Safety:** the substance of `public/eula.txt` is kept, with eye, fume, fire and emergency-stop
  details added, plus an explicit acknowledgement for CPA s49(2).
- **Warranty:** "as is" and "with all faults" in bold capitals, a plain-words explanation, and a
  pointer to the trial.
- **Liability cap:** the greater of the amount paid in the prior 12 months and US$50. The floor
  makes the cap less likely to be struck out as illusory for Free users. Carve-outs apply where the
  law forbids limits.
- **Indemnity:** business users only, never consumers.
- **Termination:** by notice for serious breach, with 14 days to put right what can be put right,
  and immediate for key sharing, circumvention or fraud. This replaces the draft's automatic
  termination on any breach, which risked being unfair and unclear.
- **Governing law:** South African law and courts, subject to consumers' mandatory home-country
  rights and courts. A 30-day attempt to settle comes first. The CISG is excluded. There is no
  arbitration and no class waiver, because of the cost to a small seller and weak enforceability
  against consumers.
- **Changes to the agreement:** they apply to versions released afterwards (accepted on install).
  Web-app changes that reduce rights get 14 days' notice.
- **Age:** 18 or over, or a parent or guardian accepts and supervises machine use.
- **Support:** no response-time promise in the agreement. Set an internal target separately
  (business decisions §5).
- **Export:** South African, US, UK and EU export and sanctions laws apply, and weapons use is
  barred.
- **Language:** English prevails.
- **Assignment:** we may transfer the agreement to a company John controls, or to a buyer of the
  business, without reducing customers' rights.
- **Privacy retention:** licence and active-device records while the licence exists;
  deactivated devices 90 days; trial records 3 years after the trial ends; order information 5
  years after the tax return covering it; support messages 2 years, including any support report
  the customer attaches; IP addresses not stored. Deletion on request, with its effect explained.
- **Support reports:** the desktop app keeps a local problem log, and Help > Save Support Report
  writes a file the customer reads and sends themselves (ADR-546). Nothing is uploaded, so the
  privacy notice still says there is no automatic crash reporting.
- **Marketing:** no marketing emails unless the customer asks.
- **Developer licences:** one sentence only, as in the draft.
- **Name and logo:** neither the agreement nor MIT licenses the KerfDesk name or logo.

## C. Lessons from LightBurn

Four fetches were allowed. All four were used on 29 September 2026:

1. https://lightburnsoftware.com/policies/refund-policy returned only site navigation and no
   policy text. **LightBurn's refund policy could not be verified.**
2. https://lightburnsoftware.com/policies/terms-of-service was read.
3. https://lightburnsoftware.com/products/add-a-year-of-updates-to-your-lightburn-license-key was
   read.
4. https://lightburnsoftware.com/pages/support-lightburn was read. It links to
   https://docs.lightburnsoftware.com/latest/Licensing/ ("Read more about our licensing model, and
   get help managing your license"), which was not fetched because the limit had been reached.

Lessons applied:

- **Keep store terms and the software licence apart.** LightBurn's terms say: "These Terms of
  Service do not apply to licenses to our software products, which are made available under a
  separate end user license agreement or other agreement." (source 2) This is why §1.5 and §7.1
  let Paddle's buyer terms govern payment and this agreement govern the software, and why the
  refund policy is a separate page.
- **A saving clause for damage exclusions.** LightBurn: "Because some states or jurisdictions do not
  allow the exclusion or the limitation of liability for consequential or incidental damages, in
  such states or jurisdictions, our liability shall be limited to the fullest extent permitted by
  law." (source 2) Applied in §12 and §14.
- **Name the implied warranties being disclaimed.** LightBurn disclaims "all implied warranties or
  conditions of merchantability, merchantable quality, fitness for a particular purpose,
  durability, title, and non-infringement" (source 2). §11 names them in the same way.
- **Governing law.** LightBurn uses Delaware law with binding arbitration in Delaware (source 2).
  Considered and not adopted, for the reasons in section B.
- **An extension keeps the same key.** LightBurn: "This will add a year of updates to your license
  key", "you will not receive a new key", and "It can take up to 24 hours for your computer to
  contact our license server to see the renewal" (source 3). Applied in §5.2.
- **Say when the extra year starts.** LightBurn's page does not say whether the year counts from
  the old expiry or from purchase; it offers "an extra two months" for extending early (source 3).
  §5.1 states the rule exactly, matching the code. The early-renewal bonus was not adopted, because
  pricing is John's decision and is already settled.
- **Send buyers to the trial first.** LightBurn's support page tells customers to "Use our free
  trial to check" their machine works (source 4). §8.2, §11 and the refund policy tie the refund
  window to the full 30-day trial.

**Not verified, and not relied on:** LightBurn's refund window, how many computers a key allows,
its deactivation and transfer rules, its trial terms, its EULA text, and its exact rule for using
versions released during the update period. KerfDesk's choices on these points rest on John's
settled decisions and on section B.

## D. Flagged: MIT licence, public repository and selling Pro

**Facts, checked 29 September 2026:**

- `LICENSE` is the MIT License, "Copyright (c) 2026 Johann Stolk", and `package.json` says
  `"license": "MIT"`. `public/eula.txt` still tells users that KerfDesk is MIT-licensed and that
  its source is public.
- GitHub reports `cisgz3a-hub/KerfDesk` as **public** (visibility public, MIT, forking allowed, 0
  forks). ADR-523 was written while it was private; John made it public again on 29 September 2026
  "for now", so pull request checks run free. Every commit pushed while it is public is published.
- ADR-247: each recipient keeps the MIT permissions for every version or copy received under MIT,
  and a later notice cannot withdraw them. A future boundary needs a new ADR with an exact cutoff
  commit and date, a final annotated MIT tag, a legal review of contributor rights, and aligned
  `LICENSE`, `package.json`, `CONTRIBUTING.md`, EULA/notices and release copy.
- All eight Pro features (V-carve, 3D relief, adaptive clearing, advanced tracing, camera
  alignment, box generator, Design Studio, G-code Inspector) already exist in the public source.
- Authors: this checkout's `git log` shows only John's `cisgz3a-hub` account and Claude. But this
  checkout is a **shallow clone** holding history from 25 September 2026 only. GitHub's contributor
  list for the whole repository shows **three** accounts: `cisgz3a-hub` (2,477 commits), `claude`
  (232) and `stolkjohannjohann-sudo` (133). All 133 of that third account's commits are authored
  as "Johann", between 29 May and 8 July 2026, and their messages mention "cross-device handoff".
  It looks like John's own second account, but only John can confirm that.

**What this means in plain terms:**

- Everything already published under MIT stays MIT for good, for anyone who has a copy. That
  includes all the Pro features above as they stand in the public repository. Anyone may use,
  copy, change, share and even sell those versions, and may strip out licence checks, as long as
  they keep the MIT notice. The Pro licence cannot stop this.
- MIT is permissive. As copyright owner, John may release future versions under different terms.
  Code written after a cutoff, and never published under MIT, can be sold under the agreement.
- While the repository stays public, every new commit can be seen and downloaded. Without a
  licence it is "all rights reserved", but it invites copying, and ADR-247 forbids calling it open
  source.
- Making the repository private stops future code from being published. It does not undo MIT for
  anything already published, cloned or forked.
- So what Pro can protect is the work done after the cutoff, plus official signed builds, updates
  and support. It cannot give exclusive rights over code that is already public.

**Status, 29 September 2026:** John confirmed step 1 at 05:29 UTC: `stolkjohannjohann-sudo` is his
own older account. PR #1022 (ADR-543) did steps 5 and 6 and was merged at 07:33 UTC. Its cutoff
commit is `2f6f84d` (#1016), the merge's first parent; step 3, tagging `mit-final` on that commit,
is still John's. Step 4 is his separate call. §16.2 now names the 29 September 2026 change.

**Recommended path, in order:**

1. **Confirm authorship.** John confirms in a dated note, kept with his business records, that
   `stolkjohannjohann-sudo` is his own account. If it belongs to
   anyone else, for example his father, get a signed copyright assignment for those commits before
   relicensing, or rewrite them.
2. **Check the AI-output position.** Confirm that the terms John used Claude under give him any
   rights in its output; Claude understands Anthropic's terms to do so, but **check**. Tell the
   lawyer that copyright in purely AI-generated code may be weak or missing in some countries (the
   US Copyright Office requires human authorship). That affects how well John can stop copying,
   not whether he may relicense.
3. **Tag the cutoff.** Choose the last commit on `main` that stays MIT, then run
   `git tag -a mit-final -m "Last KerfDesk version released under the MIT License" <sha>` and
   `git push origin mit-final`.
4. **Make the repository private before any post-cutoff code is pushed:** GitHub, Settings,
   General, Danger Zone, "Change repository visibility", Private. Side effects: GitHub Actions
   minutes stop being free (ADR-247 §4), public-repository build attestations stop, and existing
   forks and clones stay with their holders.
5. **Relicense in one commit after the tag**, inside the private repository:
   - move the MIT text out of `LICENSE` (done: it is `docs/legal/mit-final-terms.txt`, outside the
     repository root so GitHub doesn't label the repository MIT);
   - replace `LICENSE` with: "Copyright (c) 2026 Johann Stolk. All rights reserved. Versions
     released on or after [date] are licensed under the KerfDesk Licence Agreement. Versions up to
     the `mit-final` tag remain under the MIT License in `docs/legal/mit-final-terms.txt`.";
   - set `package.json` to `"license": "SEE LICENSE IN LICENSE"`;
   - update `CONTRIBUTING.md`: no outside contributions without a signed contributor agreement;
   - replace `public/eula.txt` with the safety notice and a pointer to the agreement;
   - fix the MIT statement in `THIRD_PARTY_NOTICES.md`;
   - update the website licence page and FAQ, and the app's About and Help text.
6. **Record it in a new ADR** (ADR-247 §2): the cutoff commit, date and tag, the authorship
   confirmation, the aligned files, and the correction to ADR-523.
7. **Leave MIT releases alone.** Do not delete MIT tags, releases or Preview downloads, and keep
   their MIT notices.
8. **Ship Pro only from post-cutoff code**, under the agreement, and fill in the §16.2 placeholder.

Keeping the repository public after the cutoff would make the new code source-available, all
rights reserved. That is legal, but easy to copy and hard to enforce. Claude does not recommend it
for a paid product.

## E. Placeholders only John can fill

- Legal status, trading name, and any company name and registration number: agreement §1.1 and §24,
  refund policy, privacy notice.
- Physical address, which is also the address for legal documents: §1.1, §24, refund policy,
  privacy notice.
- Telephone number, required by ECTA s43: §24.
- The Information Officer's registration number with the Information Regulator: privacy notice.
- The date sales open: all three documents.

## F. What the software and website must do for these terms to be true

1. **Free inside the commercial build.** The agreement says Free works in every version and a
   licence never blocks machine control. But ADR-523 admits the commercial workspace only after
   licence admission, and business decisions §2 still says newer versions "refuse to start until
   the licence is renewed". Build the Free/Pro split first (Pro tools lock; Free and machine
   control keep working), and update business decisions §2.
2. **Browser licensing.** Resolved: on 2026-09-29 the owner chose to sell Pro only in the desktop
   app (ADR-540 item 7). §2, §3.3, §4.6 and §6.2 and the privacy notice now say the web app is Free
   and only desktop installations count as devices.
3. **Blocking refunded keys.** §8.4 relies on being able to block a key, but the service has no
   revoke operation yet (business decisions §3). Add an admin operation that marks a licence
   inactive.
4. **Recorded acceptance.** Add unticked acceptance controls in the installer, at first run of the
   web app and at checkout, with the separate safety acknowledgement (A1.3). Store the accepted
   terms version with the licence.
5. **Retention.** Nothing is deleted automatically today. Add operator steps or jobs for
   deactivated devices (90 days), trial records (3 years), order records (after the tax period)
   and deletion requests.
6. **Website.** Replace the privacy page's "no sign-up, sign-in or activation" statements. Publish
   /terms/, /refunds/, the updated /privacy/, and /pricing/ with the Free/Pro list and the web-app
   limit (§4.6). Show the ECTA s43 details. Link the terms and refund policy from checkout; ADR-524
   §4 requires both before the store can open.
7. **Download archive.** Keep versioned desktop installers on the download host (§4.5).
8. **Labels.** Keep the app's "Updates through" date label (`src/ui/licensing/LicenceControls.tsx`)
   and its **Deactivate this device** button consistent with §2 and §6.3.
