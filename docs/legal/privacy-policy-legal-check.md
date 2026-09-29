# Legal check: KerfDesk Privacy Policy, general part

> **Internal working notes. Not legal advice. Do not publish.** Claude (an AI assistant) checked
> this at the owner's request instead of a lawyer (ADR-247 Amendment 2). Claude is not a lawyer.

Checked: `docs/legal/kerfdesk-privacy-policy.md`, the first part of https://kerfdesk.com/privacy/,
on 29 September 2026. The provisions below are cited from Claude's knowledge of them: the cloud
container that did the check cannot open the official texts, so a point that turns on exact wording
should be confirmed there. The second part of the page, `kerfdesk-privacy-notice.md` (licensing and
purchases), is checked separately; notes for it are in section 5.

## 1. Which laws apply to this part

| Law | Applies | Why |
| --- | --- | --- |
| POPIA, Act 4 of 2013 (South Africa) | Yes | The responsible party is domiciled in South Africa (s3(1)(b)(i)). An IP address is an "online identifier" and an email address is named in the definition of personal information (s1). |
| EU GDPR, Regulation (EU) 2016/679 | Yes | KerfDesk offers the free web app and Pro to people in the EU (art 3(2)(a)): English pages, US dollar prices, VAT charged where the buyer lives, EU withdrawal rights in the terms. An IP address is personal data (art 4(1); CJEU C-582/14, Breyer). |
| UK GDPR and Data Protection Act 2018 | Yes | The same test (UK GDPR art 3(2)(a)). |
| ePrivacy Directive 2002/58/EC art 5(3); UK PECR 2003 reg 6 | Yes | They cover storing anything on the user's device: autosave, settings, the offline cache and any cookie. Storage strictly necessary for the service the user asked for needs no consent. |
| CCPA/CPRA, Cal. Civ. Code §1798.100 and following | No | It binds only a "business" over one of the thresholds in §1798.140(d): gross revenue above US$25 million (adjusted for inflation), personal information of 100,000 or more consumers or households bought, sold or shared, or half of revenue from selling or sharing it. None is met. |
| Other US state privacy laws (Virginia, Colorado, Connecticut, Utah, Oregon, Texas and others) | No | Their thresholds start at 100,000 consumers in the state, or 25,000 plus revenue from selling data. Texas and Nebraska use no count but exempt small businesses as the US Small Business Administration defines them (Tex. Bus. & Com. Code §541.002). |
| CalOPPA, Cal. Bus. & Prof. Code §§22575 to 22579 | Yes | No size threshold: it binds any operator of a commercial website or online service that collects personally identifiable information, such as an email address, from California residents. |
| Delaware Online Privacy and Protection Act, 6 Del. C. §1205C | Yes | The same kind of rule for Delaware residents. |
| Nevada NRS 603A.300 to 603A.360 | Probably | Operators that collect covered information from Nevada residents and direct activities there. |
| COPPA, 15 U.S.C. §§6501 to 6506 and 16 C.F.R. part 312 | No | KerfDesk is not directed at children under 13 and does not knowingly collect their information. |
| FTC Act §5, 15 U.S.C. §45 | Yes | A false statement in a privacy policy is a deceptive practice, so every factual claim must be true. |
| ECTA, Act 25 of 2002, s43(1)(p) | Yes | A website supplier must show its security procedures and privacy policy. |
| Paddle's website review | Yes | It needs a privacy policy reachable from the site's menus. |

## 2. Clause by clause

| Section | Verdict | Law, and the fact checked |
| --- | --- | --- |
| Opening paragraph | Correct | Plain language, easy to reach: GDPR art 12(1). The page is linked from every site page's footer and from Help > Privacy Policy in the app (CalOPPA §22577(b)). |
| At a glance: no account | Correct | The app, the site and licensing have no sign-up or sign-in. |
| At a glance: no tracking, no cookies | Fixed | KerfDesk's code sets no cookie (no `document.cookie` in `src/`, `electron/`, `public/`), and the security policy blocks scripts from other sites. Cloudflare can set a security cookie when it challenges a visitor, so the policy now says "no cookies of its own" and mentions that cookie (FTC Act §5; ePrivacy art 5(3) and PECR reg 6(4), strictly necessary). |
| At a glance: your work stays with you | Correct | No code uploads projects, designs, machine details or jobs. |
| At a glance: nothing sold | Added | True; answers CalOPPA and the state laws' questions about selling and sharing. |
| What stays on your computer | Correct | The storage is strictly necessary for the service the user asked for, so no consent is needed (ePrivacy art 5(3), second sentence; PECR reg 6(4)(b)). |
| What goes over the network | Correct | Matches `website/pages/privacy.mjs`, which cites the app source. The licensing Worker's log storage is off (`"observability": { "enabled": false }` in `services/desktop-licensing/wrangler.jsonc`). What is collected and why: GDPR art 13(1)(c), POPIA s18(1)(a) and (c). |
| Our web pages | Fixed | "No cookies of their own", as above. The download page's script (`/desktop-downloads.mjs`) and the checkout page's Paddle code are both disclosed. |
| Why we use your information, and for how long | Added (was missing) | Purposes and legal basis, the legitimate interests, whether supplying the data is required, and retention or its criteria: GDPR art 13(1)(c) and (d), 13(2)(a) and (e); POPIA s11(1)(b) and (f), s14, s18(1)(c) to (e). The 2-year support retention matches the licensing notice. |
| Who else handles your information | Added | Recipients: GDPR art 13(1)(e); POPIA s18(1)(h)(i); CalOPPA §22575(b)(1). Transfers and their safeguards: GDPR art 13(1)(f), 45 (EU-U.S. Data Privacy Framework adequacy decision, Commission Implementing Decision (EU) 2023/1795), 46(2)(c) (standard contractual clauses, Commission Implementing Decision (EU) 2021/914); POPIA s18(1)(g), s72(1)(a). |
| Tracking signals and children | Added | How the site answers Do Not Track, and whether other parties track visitors across sites: CalOPPA §22575(b)(5) and (6); Delaware §1205C. Children: COPPA; POPIA ss34 and 35 (a child is under 18, s1). Consent is never the legal basis, so GDPR art 8 does not arise. |
| Who is responsible, and your rights | Added | Identity and contact: GDPR art 13(1)(a); POPIA s18(1)(b). Rights: GDPR arts 15 to 21 and 13(2)(b); POPIA ss23, 24 and 11(3), s18(1)(h)(iii) and (iv); CalOPPA §22575(b)(2). Reply within 30 days: inside GDPR art 12(3)'s one month. Complaints: GDPR arts 13(2)(d) and 77; POPIA s74 and s18(1)(h)(v). |
| Changes, and the date | Added | CalOPPA §22575(b)(3) and (4). |

## 3. Uncertain points for the owner

1. **EU and UK representatives.** A seller outside the EU that offers goods or services to people
   there must name a representative in the EU (GDPR art 27), and likewise in the UK (UK GDPR art 27),
   unless its processing is occasional, involves no large-scale sensitive data and is unlikely to
   put people at risk (art 27(2)(a)). The EDPB reads "occasional" as outside the regular course of
   business (Guidelines 3/2018 on territorial scope, section 4), and licensing every Pro buyer is
   regular. So KerfDesk most likely needs both once Pro is sold to EU and UK buyers, and arguably
   already for the free web app. Paid representative services exist. Once appointed, the policy
   must name them (art 13(1)(a)). The owner decides: appoint them, or accept the risk.
2. **Support email in a personal Gmail account.** POPIA s21 and GDPR art 28 require a written
   contract with a provider that processes personal information for us. Cloudflare's data
   processing terms cover the forwarding, but a personal Gmail account has no such contract, and it
   makes the POPIA transfer to Google rest on s72(1)(b) to (e) instead of a binding agreement. A
   business mailbox whose terms include data processing terms (Google Workspace, for example) would
   close both gaps. The policy discloses Google either way.
3. **Transfer rules for a seller outside the EU.** The adequacy decision and the standard
   contractual clauses were written for exporters in the EU. How they apply to a South African
   controller that the GDPR reaches only through art 3(2) is unsettled (EDPB Guidelines 05/2021 on
   the interplay between art 3 and Chapter V). The policy names the safeguards that exist.
4. **Nevada's designated request address** (NRS 603A.345): support@kerfdesk.com serves, and
   nothing is sold. Low risk.
5. **The date.** "Last updated" is the date the policy takes effect. Set it to the day the page goes
   live if that is later than 29 September 2026.

## 4. Facts to confirm before the page goes live

1. Cloudflare, Inc. and Google LLC are active participants in the EU-U.S. Data Privacy Framework
   with the UK Extension (https://www.dataprivacyframework.gov/list). The policy says so.
2. Cloudflare's data processing terms include the EU standard contractual clauses. The policy says
   so.
3. Cloudflare keeps connection details only as long as it needs them to deliver and protect the
   service, and its dashboard for this account shows only overall totals and security events. The
   policy says both.

## 5. Notes for the licensing and purchases notice (checked separately, not edited here)

1. "Your rights" lists access, correction, deletion and objection, but not restriction or
   portability (GDPR art 13(2)(b), arts 18 and 20). The general part lists them.
2. "We rely on their data protection terms" does not name the transfer safeguards or say how to get
   a copy (GDPR art 13(1)(f)). The general part's transfer paragraph can be reused.
3. The page goes live before the notice's "In force from" date, so the general part carries its own
   identity, rights and complaints paragraphs. If the notice's versions change, keep the two alike.
4. POPIA s18(1)(h)(v) asks for the Information Regulator's contact details; the notice gives only
   its website.
