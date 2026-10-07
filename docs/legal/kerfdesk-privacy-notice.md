# KerfDesk Privacy Notice

> **Draft for review. Not published or in force.** Publication date, public contact disclosures, retention and provider operations remain unresolved. support@kerfdesk.com is the primary support route. Email preference does not establish compliance with required disclosures.

**Last updated:** [PLACEHOLDER: publication date]. No effective date is set for this review draft.

This policy explains what personal information KerfDesk collects, why, who else handles it, how long we keep it, and what rights you have. It covers:

- our website at kerfdesk.com and its subdomains, including the KerfDesk web app and our download, support and checkout pages;
- the KerfDesk desktop apps: the free Preview builds and the licensed Windows edition;
- our licensing service (license.kerfdesk.com) and download service (dl.kerfdesk.com); and
- emails you send to our support address.

## The short version

- KerfDesk has no accounts, analytics, advertising or automatic crash reports. We do not track you across other websites or apps.
- Projects stay on your computer unless you send them or approve remote sharing. Optional phone/MCP access processes bounded summaries, approved edits/actions and separately opted-in artwork previews/text (section 3.7).
- Ordinary product pages add no analytics or advertising. The phone service uses a connection cookie, browser purchase recovery uses local storage, and Paddle may use checkout cookies (sections 3.5, 3.7 and 11).
- A Pro trial or licence sends our licensing service a few licensing details. They include a one-way code made from your Windows installation's ID, never the ID itself.
- Paddle resells KerfDesk Pro as merchant of record and takes your payment. We never see your full card number.
- We do not sell your personal information. We do not send marketing emails unless you ask us to.
- You can ask to see, correct or delete your information (section 9).

**Current configuration.** Checked-in production licensing enables activation and trials, while payments and website sales/trial launch flags remain closed. Configuration is separate from live merchant approval. This is a review draft, not the published notice.

## 1. Who we are

KerfDesk is made and licensed by **Johannes Stephanus Stolk**, a sole proprietor (an individual, not a company) trading as KerfDesk, of [PLACEHOLDER: public legal-service address unresolved], South Africa. In this policy, “we”, “us” and “our” mean him.

He decides how your personal information is used and is responsible for it. South African law calls him the “responsible party”; EU and UK law call him the “controller”. Paddle is responsible for the information it collects at checkout (section 3.5).

He is also our Information Officer under South African law.

**Contact us** about anything in this policy:

- Email: support@kerfdesk.com (please put “Privacy” in the subject)
- Post: [PLACEHOLDER: public legal-service address unresolved], South Africa
- Telephone: [PLACEHOLDER: public telephone availability unresolved]

Our PAIA manual, which explains how to ask for records under South Africa's Promotion of Access to Information Act, is at https://kerfdesk.com/paia-manual/.

## 2. What KerfDesk does not do

- No analytics, telemetry, advertising or tracking.
- No automatic crash or error reports.
- No KerfDesk account or automatic project cloud synchronization. Approved phone/MCP clients have separate access credentials.
- Licensing does not upload projects, drawings, toolpaths, machine settings or jobs. Optional phone/MCP sharing is described separately in section 3.7.
- No selling or renting of your personal information, and no sharing of it for advertising.

## 3. What we collect, and why

### 3.1 When you visit our website or use the web app

Cloudflare delivers our website and the web app. Each time your browser asks for a page or file, Cloudflare receives the details every website receives: your IP address, the time, the address of the page, and your browser's standard technical details, such as its type, version and language.

- We add no analytics or tracking. Cloudflare's dashboard shows us overall totals, such as the number of requests and the countries they came from. It also shows details, including the IP address, of requests that Cloudflare's security features block or challenge. We use these only to keep our website working and secure.
- The ordinary browser workspace uses its documented first-party connections and a camera helper on your computer. A separate payment page loads Paddle checkout; optional remote access uses the distinct service in section 3.7.
- Your browser keeps the web app's files so that it works offline. When you open the web app online, it checks kerfdesk.com for a newer version. Lesson and CNC bit pictures you open are kept for up to 30 days.

**Why:** to deliver the pages and files you ask for, and to keep them secure.

### 3.2 What stays on your computer

The following remains local unless you send it or approve sharing described in section 3.7:

- **Your projects.** You save them as files, where you choose.
- **Working data.** KerfDesk keeps an autosaved copy of your open project, your material and bit libraries, your settings (including machine, connection and camera settings, and the names of recent projects), your lesson progress, a checkpoint for resuming an interrupted job. In a browser, clearing the site data for kerfdesk.com removes them.
- **The desktop log.** The desktop app keeps a log file on your computer: a line each time it starts (its version and your operating system), its own messages, and its warnings and errors. On Windows it is in the logs folder inside the laserforge folder in %APPDATA%; Help > Open Data Folder shows it. The app removes licence keys, and writes your home folder as “~”, before a line is saved.
- **Your saved licence.** The licensed Windows app keeps your licence key, licence details and any unfinished order codes encrypted with Windows' own data protection.
- **Your machine and cameras.** KerfDesk talks to your machine over the USB cable you connect. In a browser, it can use a USB camera only after you allow it. It asks for video only, never sound, and the picture stays on your computer. The desktop app's camera helper connects only to your own computer and to cameras on your private network, never to the internet. When you open the Camera panel, it looks for a machine's built-in camera at four fixed addresses on your local network.

### 3.3 Downloads and update checks

- Installers download from dl.kerfdesk.com, which Cloudflare serves. Our download page also reads the list of versions from there. Cloudflare sees the usual connection details.
- **Desktop Preview.** When you open it, it asks dl.kerfdesk.com once whether a newer Preview exists. It sends no project, design, machine, job or device details and no cookies, and it identifies itself only as “KerfDesk-Desktop-Preview”. It never downloads or installs anything by itself. The Preview builds never contact our licensing service and never read your Windows installation ID.
- **Current unsigned licensed Windows app.** At startup, every 30 minutes while open and when you choose Check for Updates, it checks dl.kerfdesk.com for available versions. A covered installer downloads only when you choose **Download update**. Installation is armed only when you choose **Install when I close KerfDesk**; it starts after KerfDesk completes its ordinary close safeguards. No project, design, machine or job details are sent. Signed release metadata verifies the downloaded bytes; it is not Windows publisher code signing.
- **Separate signed Windows lane.** Its update component can download a covered update and apply it at an ordinary close. It can send a random saved update ID. This draft does not establish that this lane is enabled, signed or qualified for release.
- **Aggregate download statistics.** The owner can view Cloudflare request estimates grouped by date, version, platform and estimated request country. Repeat requests and partial downloads count; VPNs/proxies can affect country. These figures do not identify people or prove installation. The local dashboard saves aggregate figures, without IP addresses, device identifiers or licence details, and adds no tracking script or cookie.

**Why:** to provide the software and updates you asked for, and to keep them secure.

### 3.4 Pro trials and licences

The licensed Windows app contacts our licensing service at license.kerfdesk.com when you start a trial, activate a licence, deactivate a computer, start a purchase or renewal, or confirm a payment. It also confirms your licence in the background about once a week, when you are online. The ordinary browser workspace does not activate a device. The separate purchase page checks availability, creates an order and claims the fulfilled key through documented browser endpoints. Browser renewal and activation are not supported.

The app sends only:

- **An installation code.** The app reads your Windows installation ID (the “MachineGuid” that Windows creates when it is installed) and turns it, on your computer, into a one-way code (a hash) that only KerfDesk uses. The ID itself never leaves your computer. The app works out this code when it starts, but sends it only for the licence actions listed above. We treat this code as personal information and use it only for licensing. We never match it with information from other companies.
- **A generic device label:** “Windows computer”. Your computer's real name is never sent.
- **Your licence key**, when you activate it or use it to renew. When the app checks, renews through or deactivates this computer, it sends the licence number, activation number and activation code the service gave this computer.
- **Order codes**, when you buy or renew: a random checkout code the app makes, and later the order number and one-time claim code that the service gave it.

The licensing service keeps:

- **Your licence:** its number, type (trial or paid), status, key version, issue date, and trial end date or update end date, plus a keyed one-way hash of your licence key, never the key.
- **Each computer that has used it:** an activation number, a keyed hash of its installation code, the device label, the date it was activated, whether it is still active, and the dates you moved the licence between computers.
- **Your orders:** the order number, Paddle's transaction number and the IDs of Paddle's payment messages, what you bought (with Paddle's price code), the price and currency, and the order's status and dates. If Paddle refuses to create a checkout, it keeps Paddle's error code. If the service refuses a payment, it also keeps Paddle's amounts (price, tax, total and any discount) and the reason. Checkout and claim codes are kept only as keyed hashes.
- **Records of our own administrative actions**, such as looking up, cancelling or deleting a licence: which licence or order, what was done, and when. They hold no keys, names or email addresses. A trial's licence number is made from the keyed hash of its installation code, so our record of deleting a trial keeps that hash.

It does not keep your name, email address, postal address, IP address or any card details.

Cloudflare receives your IP address, and the app's standard technical details (such as the app's version and your operating system), with each request. The service uses your IP address only to limit how many requests one address can make in a minute, which protects the service, and does not store it. The service also writes a short technical line about each request (its type, result and duration, with no IDs, keys or IP addresses). Workers Logs and sampled diagnostics may retain these bounded lines. Provider retention requires confirmation before publication; this draft does not claim logs are never stored.

You do not have to use a trial or a licence: the Free features work without one. Without the details above, we cannot give you a trial or a licence.

**Why:** to provide the trial or licence you asked for; to apply the licence rules fairly (one trial per Windows installation, and up to three active computers per licence); and to prevent abuse and fraud and keep the service secure.

### 3.5 Buying Pro through Paddle

Sales have not opened yet. When they do, you can start a new purchase in Help > Licence in the licensed Windows app or on kerfdesk.com/buy.html in a supported browser, including a phone. Renew an existing licence from the Windows app. Paddle checkout handles payment.

**Paddle** is our reseller and the merchant of record for every order. It sells KerfDesk Pro to you, takes the payment, charges tax, sends your receipt and handles refunds. The Paddle company that sells to you is named on your receipt: Paddle.com Inc. in the United States, Paddle.com (Canada) Ltd in Canada, and Paddle.com Market Limited everywhere else. Paddle decides for itself how it uses the information you give it at checkout, under its own privacy notice at https://www.paddle.com/legal/privacy (privacy@paddle.com).

- Our checkout page, kerfdesk.com/buy.html, is the only page on our website that loads code from another company's servers: Paddle's checkout, from cdn.paddle.com. It loads when an available checkout is opened for an order created through the Windows app or a supported purchase browser. Paddle's checkout may store cookies or similar data on your device, and collects details about your device, browser and IP address, to take the payment and prevent fraud.
- You give your payment details, email address, country and, where tax rules need them, your address or business details to Paddle, not to us. We never see your full card number.
- When a payment is complete, Paddle sends our licensing service a message about it. The message includes the order number, what was bought and the amounts. It also includes Paddle's customer and address reference numbers (and a business reference number if you bought as a business) and, for a card, the card type, last four digits, expiry date and cardholder name. The service keeps only what is listed in section 3.4 and discards the rest.
- Paddle also lets us see your order information in its seller dashboard: your name and address (if you gave them), your email address, what you bought, the price, tax and date, and your purchase history with us.

We use Paddle's information only to provide and support your licence, to handle refunds, chargebacks and disputes, to prevent fraud, and to keep our accounts.

Browser purchase recovery persistently saves a random request ID, then order ID and claim credential, before opening Paddle. Scripts on that first-party origin can access this storage. Clearing site data or private browsing can lose recovery information. Credentials travel in JSON bodies, never query parameters. Only a verified webhook fulfils an order; the page then claims and displays the key. Save the key and receipt. There is no automatic key email; recovery requires support and private ownership verification.

### 3.6 When you email us

Email to support@kerfdesk.com passes through Cloudflare Email Routing and arrives in our mailbox at Google (Gmail). We receive whatever you send: your email address and name, your message and any attachments, such as a support report, project files or photos. The draft assumes the established Cloudflare-to-Gmail support route. Provider message/log handling, current retention periods and account terms still need verification before publication; this draft sets no fixed provider deletion promise.

**Support reports.** Help > Save Support Report, in the web app and the desktop app, saves a text file on your computer for you to read and, if you choose, send to us. It contains:

- your KerfDesk version and edition, your licence's status and dates (for example when a trial ends), and whether you use the web or desktop app;
- your browser or app version, operating system, languages and screen size;
- your machine's profile, connection, controller state, positions and settings, and the last 100 lines of its console;
- recent errors in the app; and
- in the desktop app, the newest part of the desktop log.

It never contains your licence key or payment details. Error messages can include file or folder names, so please read the report and remove anything you would rather not share. Please never email us your licence key, card numbers, passwords or identity documents.

You do not have to email us or send a report, but without them we may not be able to help.

**Why:** to answer you and fix problems.

### 3.7 Optional phone and MCP access

Remote access starts turned off and needs no KerfDesk account. If you turn it on in desktop Settings, the app connects to kerfdesk-phone-control.cisgz3a.workers.dev, a separate service hosted by Cloudflare. Each phone or MCP client needs a short-lived pairing code and your approval on the computer. Viewing, artwork editing and machine control are separate permissions. Editing and machine control start unchecked in the PC approval. The computer must stay awake, online and running KerfDesk.

Approved requests and responses pass through this service. Responses contain bounded artwork and operation summaries, machine limits, edition and update status, and material recipes. Editing clients can change supported artwork and ordinary laser operation settings, including text, layout and the shared Undo/Redo history. Separately approved machine-control clients can use discrete Jog, Frame, current Job Review, confirmed Start and Abort. They cannot change the machine connection, send console commands or read arbitrary files. Licence and payment credentials, serial-port identities, saved file paths and complete project files are excluded.

A separate setting, Share artwork previews and text with approved phones and MCP apps, starts turned off. If you enable it on the PC, approved clients can request a bounded PNG artwork preview and existing text contents. Pairing or granting editing permission alone does not enable sharing. Operation labels and artwork-derived warning wording are hidden while sharing is off because they can contain the design's text. An MCP client may send approved summaries, shared previews and text to its AI provider under that provider's privacy terms. Turning sharing off prevents later preview/text reads, but cannot retrieve content already received by a client. Remote access does not synchronize complete project files.

The computer saves its remote identity, opt-in and credentials in a separate file encrypted using operating-system secure storage. The service stores a random computer ID, a generic computer label, a one-way hash of its owner credential, and approved client identifiers, labels, permissions and expiry information. It stores phone-session credentials as one-way hashes. Command arguments and workspace responses are processed in memory and are not written to the service's databases. To prevent repeated machine actions after a lost reply, the service stores bounded records of admitted action IDs, a one-way digest of each command's validated inputs, its approval lease and short outcome flags. These records contain no artwork, text contents, job review or executable G-code. Old action IDs stay consumed for that approval rather than being deleted to make room for another action.

The separate phone page uses a Secure, HttpOnly, SameSite=Strict cookie to keep your approved connection for eight hours. It does not renew that period merely because you visit it. Pairing offers and pending claims expire after five minutes. An MCP access token lasts thirty minutes; an approval with refresh access can last up to thirty days. Authorization transactions and unexchanged authorization codes expire after ten minutes. OAuth client registrations have a ninety-day idle retention period, renewed by successful token exchanges.

Expired pairing and approval records are removed when the computer or client next uses the relevant service, including the expired approval's action records. There is no promised deletion timer for an idle computer. Revoking a connection removes its desktop approval immediately and blocks its old tokens; remaining OAuth action records are removed with that approval. Remaining OAuth database records expire under the limits above or are removed when a refused refresh triggers cleanup. The computer registration and owner-credential hash remain for later reconnection. Turning access off closes the connection immediately and saves a pending revocation; if the computer is offline, the service receives that revocation when it next connects.

Like other web services, Cloudflare receives normal connection details such as your IP address and time. Sampled service logs and platform diagnostic metadata may be retained by the hosting provider; the service does not deliberately log workspace payloads or credentials. You can use the ordinary desktop app without enabling remote access.

## 4. Our legal reasons for using your information

The law says we need a valid reason for each use of your information. These are ours:

| What we do                                                                                                                                                      | EU and UK law (GDPR)                                                                                                    | South African law (POPIA)                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Deliver our website, web app, downloads and updates, and keep them secure                                                                                       | Our legitimate interests in providing what you ask for, securely (Article 6(1)(f))                                      | Legitimate interests (section 11(1)(f))                                              |
| Provide trials and licences; activate, check and deactivate computers; fulfil orders                                                                            | Performing our agreement with you (Article 6(1)(b))                                                                     | Performing our agreement with you (section 11(1)(b))                                 |
| Allow one trial per installation and apply the device limit; prevent abuse and fraud; limit requests per IP address; keep records of our administrative actions | Our legitimate interests in fair licensing, preventing piracy and fraud, and running a secure service (Article 6(1)(f)) | Legitimate interests (section 11(1)(f))                                              |
| Answer your emails and support reports                                                                                                                          | Performing our agreement with you, or our legitimate interest in helping people use KerfDesk (Article 6(1)(b) or (f))   | Section 11(1)(b) or (f)                                                              |
| Handle refunds, chargebacks, disputes and legal claims                                                                                                          | Our legitimate interests in resolving them (Article 6(1)(f))                                                            | Section 11(1)(b) or (f)                                                              |
| Keep accounting and tax records                                                                                                                                 | Our legitimate interest in complying with South African tax law (Article 6(1)(f))                                       | A legal obligation: Tax Administration Act 28 of 2011, section 29 (section 11(1)(c)) |
| Report security breaches; answer lawful requests from authorities                                                                                               | A legal obligation where EU or UK law applies (Article 6(1)(c)); otherwise our legitimate interests (Article 6(1)(f))   | A legal obligation (section 11(1)(c))                                                |
| Move the business to a new owner (section 5)                                                                                                                    | Our legitimate interest in continuing KerfDesk (Article 6(1)(f))                                                        | Legitimate interests (section 11(1)(f))                                              |
| Send marketing emails you ask for                                                                                                                               | Your consent, which you can withdraw at any time (Article 6(1)(a))                                                      | Your consent (sections 11(1)(a) and 69)                                              |

Where we rely on legitimate interests, you can object (section 9).

No law requires you to give us personal information. You need to give the details in section 3.4 only if you want a trial or a licence, and Paddle's checkout details only if you want to buy.

## 5. Who else handles your information

- **Cloudflare, Inc.** (United States) hosts our website and web app (Cloudflare Pages), runs our licensing service and its database (Cloudflare Workers and Durable Objects), serves our downloads (Cloudflare R2) and forwards support email (Cloudflare Email Routing). It provides data processing terms and uses connection data under its own privacy policy to protect its network. Applicable account terms and safeguards remain to be verified for publication.
- **Google LLC** (United States) provides the mailbox (Gmail) where support email arrives.
- **Paddle** sells KerfDesk Pro as reseller and merchant of record, under its own privacy notice (section 3.5). We give Paddle order numbers when we ask it to refund an order or to help with a request.
- **Professional advisers**, such as an accountant or lawyer, who must keep it confidential.
- **Courts, regulators, and tax or law enforcement authorities**, when the law requires.
- **A new owner of KerfDesk.** If the business moves to a company that Johannes Stephanus Stolk controls, or to a buyer, your information goes with it and stays protected as this policy describes.

## 6. Where your information goes

We are in South Africa. Our providers work in other countries:

- Cloudflare runs our services from its data centres around the world. Database location, provider terms and international-transfer arrangements need confirmation; this source inspection did not verify provider placement.
- Google keeps email in its data centres, which are in the United States and other countries.
- Paddle is based in the United Kingdom, with companies in the United States, Canada and Ireland.

**Transfer safeguards remain unresolved for publication.** The applicable Cloudflare, Google and Paddle account/data-processing terms, their transfer mechanisms and current certifications must be checked against the actual accounts and destinations. This draft does not assert that a particular agreement, certification or exemption already satisfies POPIA, EU or UK requirements. Required copies, representative arrangements and applicable legal bases must be settled before the final notice describes them as established facts.

## 7. How long we keep it

The current licensing service has no scheduled retention cleanup. It does not automatically remove unpaid orders, expired trials, revoked licences, administrative audit records or backups after fixed deadlines. Deactivation marks an installation inactive and frees its seat; it does not delete every related record.

- Licence and order records are retained for activation, entitlements, payment reconciliation and support. The implementation does not enforce a maximum retention period. We review these records manually at least monthly and retain them while needed to fulfil a valid licence, resolve a payment or dispute, or meet a legal obligation. There is no automatic deletion timer.
- An authenticated operator can delete a customer's licence/order and associated records after verifying the request. Paid/developer licences must first be revoked. Administrative audit records remain. There is no customer self-service deletion endpoint.
- We review support correspondence and private backups manually, remove material no longer needed for the request or licence, and restrict access to material retained for legal obligations or disputes. Provider logs and Paddle payment records follow their providers' published retention criteria; we do not promise an automatic deletion timer for those systems.
- Paddle retains its own payment records under its notice and legal obligations.
- Optional remote-service expiry/cleanup is described in section 3.7 and differs from licensing retention. An idle computer has no promised deletion timer.
- Local project/purchase data remains until it is cleared or deleted. Clearing browser purchase data can prevent recovery; save the key and receipt first.

Email support@kerfdesk.com to request access, correction or deletion. Identity must be verified and any legal retention explained. We verify ownership privately, explain any information we must retain and give the outcome of the request.

## 8. Security

- Card details go only into Paddle's checkout. Paddle states that it complies with the payment card industry's security standard (PCI DSS); see https://trust.paddle.com. We never receive your full card number.
- Our website, web app, licensing service and downloads use encrypted connections (HTTPS).
- Our licensing service stores licence keys, activation codes, checkout and claim codes, and installation codes only as keyed one-way hashes. The key that signs licences is kept outside the database. Every licence is signed, so the app can detect a forged one.
- Only we can use the service's administration tools, with a secret credential, and each use is recorded.
- The licence saved on your computer is encrypted with Windows' own data protection.
- No system is perfectly secure. If a security breach affects your personal information, we will tell you and the authorities as the law requires. For example, we report breaches to South Africa's Information Regulator, and, where the law requires, to the relevant EU or UK authority within 72 hours.

## 9. Your rights

**Wherever you live**, you can ask us:

- whether we hold personal information about you, and for a copy of it;
- to correct it if it is wrong or incomplete;
- to delete it;
- to stop using it where we rely on our legitimate interests (to object); and
- to stop sending you marketing, if you asked for any.

**How to ask.** Email support@kerfdesk.com with “Privacy request” in the subject, or write to us. We may ask you to show that the information is yours, for example with the order or transaction number on your Paddle receipt, the email address you bought with, or your licence number (the middle part of your licence key). Never send us your whole licence key. We do not charge for requests.

**When we answer.** Within 30 days, or within one calendar month if that ends sooner. If a request is complicated, we may need longer: up to two more months for requests under EU or UK law, or up to 30 more days for South African requests under PAIA. If so, we will tell you why within the first period.

**Deleting a licence.** To delete a paid licence, we first cancel it and then delete its records. Computers that already have it keep the Pro rights saved on them, but one that checks in before we finish loses Pro. You can no longer activate the licence on any computer, and we cannot restore it. We keep what the law requires us to keep, and a short record that we carried out your request.

**Paddle's records.** We cannot change or delete Paddle's records. Ask Paddle at privacy@paddle.com. We will help Paddle with requests about your order.

### If you are in the European Economic Area or the UK

You also have the right to:

- ask us to restrict (pause) our use of your information;
- receive the information you gave us for your licence in a common, machine-readable format, or have it sent to someone else (data portability); and
- withdraw your consent at any time, where we rely on it. This does not affect what we did before.

You can complain to us first: email support@kerfdesk.com with “Privacy complaint” in the subject, or write to us at the address in section 1. In the UK, we will acknowledge your complaint within 30 days and tell you the outcome without undue delay. You can also complain to a data protection authority:

- in the EEA, the authority in the country where you live or work, or where you think the problem happened (list: https://www.edpb.europa.eu/about-edpb/about-edpb/members_en);
- in the UK, the Information Commission's Office (ICO): https://ico.org.uk/make-a-complaint/, helpline 0303 123 1113, 4th Floor, No.3 Circle Square, 5 Hawkshaw Street, Manchester M1 7BL.

### If you are in South Africa

POPIA gives you the rights above (sections 23 to 25, and section 11(3)). The POPIA Regulations provide forms for an objection (Form 1) and for a correction or deletion (Form 2); we also accept a simple email. To ask for records, see our PAIA manual (section 1).

You can complain to the Information Regulator:

- Address: Woodmead North Office Park, 54 Maxwell Drive, Woodmead, Johannesburg, 2191
- Complaints: POPIAComplaints@inforegulator.org.za
- General enquiries: enquiries@inforegulator.org.za
- Telephone: 010 023 5200 (toll-free 0800 017 160)
- Website and online complaint form: https://inforegulator.org.za

### If you are in the United States

- **Reviewing or changing your information** (including under California law): email us as described above.
- **Do Not Track.** KerfDesk does not track you across other websites or apps over time, so we do not change anything when your browser sends a Do Not Track signal.
- **Other companies.** Paddle handles checkout information; Cloudflare handles hosting/security; Google handles support email. Optional approved MCP clients can process shared information with their AI provider (section 3.7). We add no advertising or cross-site tracking.
- **Nevada.** We do not sell personal information. You can still send a request not to sell to our designated address, support@kerfdesk.com.

## 10. Decisions made by computer

We make no decisions about you by computer alone that have legal or similarly significant effects. Our licensing service applies the licence rules automatically: one trial per Windows installation, up to three active computers, a limit on how often a licence moves between computers, and refusing a payment that does not match its order. If you think it got something wrong, email us and a person will review it.

## 11. Cookies and similar technology

- Ordinary product pages set no application cookies. We use no analytics, advertising or social media cookies. The separate approved phone service uses its connection cookie (section 3.7).
- The web app and desktop app store working data on your device (section 3.2), because they need it to work. It stays on your device.
- Cloudflare, which delivers our pages, may set a strictly necessary security cookie (such as \_\_cf_bm or cf_clearance) when it needs to check that a visitor is not an automated attack.
- On our checkout page, Paddle's checkout may set cookies or use similar storage to take the payment and prevent fraud. See Paddle's privacy notice.
- Browser purchase recovery saves first-party order/claim data (section 3.5). A separate signed updater can save its random update ID (section 3.3).

## 12. Children

KerfDesk is for adults. It is not aimed at children, and we do not knowingly collect personal information from anyone under 13, or from anyone under 18 without a parent's or guardian's consent. If you think a child has sent us personal information, email us and we will delete it.

## 13. Marketing

We do not send marketing emails, text messages or calls. We will send marketing only if you ask for it, and every message will let you stop it. We email customers only about their order, licence, refund, support request or security, or about a significant change to this policy or our terms (section 14).

## 14. Changes to this policy

When we change this policy, we will post the new version here with a new date and a summary of what changed. If a change significantly affects how we use information we already hold about you, we will tell you before it applies: on this page and, if we have your email address, by email. Ask us for a copy of any earlier version.

## 15. Contact

Johannes Stephanus Stolk, trading as KerfDesk
[PLACEHOLDER: public legal-service address unresolved], South Africa
Email: support@kerfdesk.com
Telephone: [PLACEHOLDER: public telephone availability unresolved]
Website: https://kerfdesk.com
