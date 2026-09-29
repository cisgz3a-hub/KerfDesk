# KerfDesk Privacy Notice

**Last updated:** [PLACEHOLDER: publication date]. This version applies from that date.

This policy explains what personal information KerfDesk collects, why, who else handles it, how long we keep it, and what rights you have. It covers:

- our website at kerfdesk.com and its subdomains, including the KerfDesk web app and our download, support and checkout pages;
- the KerfDesk desktop apps: the free Preview builds and the licensed Windows edition;
- our licensing service (license.kerfdesk.com) and download service (dl.kerfdesk.com); and
- emails you send to our support address.

## The short version

- KerfDesk has no accounts, analytics, advertising or automatic crash reports. We do not track you across other websites or apps.
- Your projects, designs, machine settings and jobs stay on your computer. We only see them if you send them to us.
- Our own pages set no cookies, although our host, Cloudflare, may set a security cookie (section 11). The only page that loads code from another company's servers is our checkout page, which loads Paddle's checkout.
- A Pro trial or licence sends our licensing service a few licensing details. They include a one-way code made from your Windows installation's ID, never the ID itself.
- Paddle resells KerfDesk Pro as merchant of record and takes your payment. We never see your full card number.
- We do not sell your personal information. We do not send marketing emails unless you ask us to.
- You can ask to see, correct or delete your information (section 9).

**Pro trials and sales have not opened yet.** The licensed Windows app is not released, and our licensing service is switched off. Sections 3.4 and 3.5 explain what will happen once trials and sales open.

## 1. Who we are

KerfDesk is made and licensed by **Johannes Stephanus Stolk**, a sole proprietor (an individual, not a company) trading as KerfDesk, of [PLACEHOLDER: physical street address], South Africa. In this policy, “we”, “us” and “our” mean him.

He decides how your personal information is used and is responsible for it. South African law calls him the “responsible party”; EU and UK law call him the “controller”. Paddle is responsible for the information it collects at checkout (section 3.5).

He is also our Information Officer under South African law.

**Contact us** about anything in this policy:

- Email: support@kerfdesk.com (please put “Privacy” in the subject)
- Post: [PLACEHOLDER: physical street address], South Africa
- Telephone: [PLACEHOLDER: telephone number]

Our PAIA manual, which explains how to ask for records under South Africa's Promotion of Access to Information Act, is at https://kerfdesk.com/paia-manual/.

## 2. What KerfDesk does not do

- No analytics, telemetry, advertising or tracking.
- No automatic crash or error reports.
- No accounts, passwords or cloud sync.
- No uploading of your projects, drawings, toolpaths, machine settings or job data.
- No selling or renting of your personal information, and no sharing of it for advertising.

## 3. What we collect, and why

### 3.1 When you visit our website or use the web app

Cloudflare delivers our website and the web app. Each time your browser asks for a page or file, Cloudflare receives the details every website receives: your IP address, the time, the address of the page, and your browser's standard technical details, such as its type, version and language.

- We add no analytics or tracking. Cloudflare's dashboard shows us overall totals, such as the number of requests and the countries they came from. It also shows details, including the IP address, of requests that Cloudflare's security features block or challenge. We use these only to keep our website working and secure.
- The web app can connect only to kerfdesk.com and to a camera helper on your own computer. It loads no code from other companies' servers.
- Your browser keeps the web app's files so that it works offline. When you open the web app online, it checks kerfdesk.com for a newer version. Lesson and CNC bit pictures you open are kept for up to 30 days.

**Why:** to deliver the pages and files you ask for, and to keep them secure.

### 3.2 What stays on your computer

None of the following is sent to us unless you choose to send it:

- **Your projects.** You save them as files, where you choose.
- **Working data.** KerfDesk keeps an autosaved copy of your open project, your material and bit libraries, your settings (including machine, connection and camera settings, and the names of recent projects), your lesson progress, and a checkpoint for resuming an interrupted job. In a browser, clearing the site data for kerfdesk.com removes them.
- **The desktop log.** The desktop app keeps a log file on your computer: a line each time it starts (its version and your operating system), its own messages, and its warnings and errors. On Windows it is in the logs folder inside the laserforge folder in %APPDATA%; Help > Open Data Folder shows it. The app removes licence keys, and writes your home folder as “~”, before a line is saved.
- **Your saved licence.** The licensed Windows app keeps your licence key, licence details and any unfinished order codes encrypted with Windows' own data protection.
- **Your machine and cameras.** KerfDesk talks to your machine over the USB cable you connect. In a browser, it can use a USB camera only after you allow it. It asks for video only, never sound, and the picture stays on your computer. The desktop app's camera helper connects only to your own computer and to cameras on your private network, never to the internet. When you open the Camera panel, it looks for a machine's built-in camera at four fixed addresses on your local network.

### 3.3 Downloads and update checks

- Installers download from dl.kerfdesk.com, which Cloudflare serves. Our download page also reads the list of versions from there. Cloudflare sees the usual connection details.
- **Desktop Preview.** When you open it, it asks dl.kerfdesk.com once whether a newer Preview exists. It sends no project, design, machine, job or device details and no cookies, and it identifies itself only as “KerfDesk-Desktop-Preview”. It never downloads or installs anything by itself. The Preview builds never contact our licensing service and never read your Windows installation ID.
- **Licensed Windows app.** It checks dl.kerfdesk.com for new versions. When a newer version your licence covers exists, it downloads it and installs it when you close KerfDesk. When it fetches an update, its update component also sends a random ID that it created and saved on your computer. This ID is not linked to your licence, and we do not keep or use it.

**Why:** to provide the software and updates you asked for, and to keep them secure.

### 3.4 Pro trials and licences

The licensed Windows app contacts our licensing service at license.kerfdesk.com when you start a trial, activate a licence, deactivate a computer, start a purchase or renewal, or confirm a payment. It also confirms your licence in the background about once a week, when you are online. The web app has no licence and never contacts the service. Our checkout page asks the service only whether checkout is open.

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

Cloudflare receives your IP address, and the app's standard technical details (such as the app's version and your operating system), with each request. The service uses your IP address only to limit how many requests one address can make in a minute, which protects the service, and does not store it. The service also writes a short technical line about each request (its type, result and duration, with no IDs, keys or IP addresses). We do not store these lines.

You do not have to use a trial or a licence: the Free features work without one. Without the details above, we cannot give you a trial or a licence.

**Why:** to provide the trial or licence you asked for; to apply the licence rules fairly (one trial per Windows installation, and up to three active computers per licence); and to prevent abuse and fraud and keep the service secure.

### 3.5 Buying Pro through Paddle

Sales have not opened yet. When they do, you will start a purchase or renewal in the licensed Windows app, and pay on our checkout page.

**Paddle** is our reseller and the merchant of record for every order. It sells KerfDesk Pro to you, takes the payment, charges tax, sends your receipt and handles refunds. The Paddle company that sells to you is named on your receipt: Paddle.com Inc. in the United States, Paddle.com (Canada) Ltd in Canada, and Paddle.com Market Limited everywhere else. Paddle decides for itself how it uses the information you give it at checkout, under its own privacy notice at https://www.paddle.com/legal/privacy (privacy@paddle.com).

- Our checkout page, kerfdesk.com/buy.html, is the only page on our website that loads code from another company's servers: Paddle's checkout, from cdn.paddle.com. It loads only when you open the page to pay for an order started in the Windows app. Paddle's checkout may store cookies or similar data on your device, and collects details about your device, browser and IP address, to take the payment and prevent fraud.
- You give your payment details, email address, country and, where tax rules need them, your address or business details to Paddle, not to us. We never see your full card number.
- When a payment is complete, Paddle sends our licensing service a message about it. The message includes the order number, what was bought and the amounts. It also includes Paddle's customer and address reference numbers (and a business reference number if you bought as a business) and, for a card, the card type, last four digits, expiry date and cardholder name. The service keeps only what is listed in section 3.4 and discards the rest.
- Paddle also lets us see your order information in its seller dashboard: your name and address (if you gave them), your email address, what you bought, the price, tax and date, and your purchase history with us.

We use Paddle's information only to provide and support your licence, to handle refunds, chargebacks and disputes, to prevent fraud, and to keep our accounts.

### 3.6 When you email us

Email to support@kerfdesk.com passes through Cloudflare Email Routing and arrives in our mailbox at Google (Gmail). We receive whatever you send: your email address and name, your message and any attachments, such as a support report, project files or photos. Cloudflare does not keep the message, but it keeps an activity log showing the sender, recipient, subject and whether the message was delivered, for 31 days.

**Support reports.** Help > Save Support Report, in the web app and the desktop app, saves a text file on your computer for you to read and, if you choose, send to us. It contains:

- your KerfDesk version and edition, your licence's status and dates (for example when a trial ends), and whether you use the web or desktop app;
- your browser or app version, operating system, languages and screen size;
- your machine's profile, connection, controller state, positions and settings, and the last 100 lines of its console;
- recent errors in the app; and
- in the desktop app, the newest part of the desktop log.

It never contains your licence key or payment details. Error messages can include file or folder names, so please read the report and remove anything you would rather not share. Please never email us your licence key, card numbers, passwords or identity documents.

You do not have to email us or send a report, but without them we may not be able to help.

**Why:** to answer you and fix problems.

## 4. Our legal reasons for using your information

The law says we need a valid reason for each use of your information. These are ours:

| What we do | EU and UK law (GDPR) | South African law (POPIA) |
| --- | --- | --- |
| Deliver our website, web app, downloads and updates, and keep them secure | Our legitimate interests in providing what you ask for, securely (Article 6(1)(f)) | Legitimate interests (section 11(1)(f)) |
| Provide trials and licences; activate, check and deactivate computers; fulfil orders | Performing our agreement with you (Article 6(1)(b)) | Performing our agreement with you (section 11(1)(b)) |
| Allow one trial per installation and apply the device limit; prevent abuse and fraud; limit requests per IP address; keep records of our administrative actions | Our legitimate interests in fair licensing, preventing piracy and fraud, and running a secure service (Article 6(1)(f)) | Legitimate interests (section 11(1)(f)) |
| Answer your emails and support reports | Performing our agreement with you, or our legitimate interest in helping people use KerfDesk (Article 6(1)(b) or (f)) | Section 11(1)(b) or (f) |
| Handle refunds, chargebacks, disputes and legal claims | Our legitimate interests in resolving them (Article 6(1)(f)) | Section 11(1)(b) or (f) |
| Keep accounting and tax records | Our legitimate interest in complying with South African tax law (Article 6(1)(f)) | A legal obligation: Tax Administration Act 28 of 2011, section 29 (section 11(1)(c)) |
| Report security breaches; answer lawful requests from authorities | A legal obligation where EU or UK law applies (Article 6(1)(c)); otherwise our legitimate interests (Article 6(1)(f)) | A legal obligation (section 11(1)(c)) |
| Move the business to a new owner (section 5) | Our legitimate interest in continuing KerfDesk (Article 6(1)(f)) | Legitimate interests (section 11(1)(f)) |
| Send marketing emails you ask for | Your consent, which you can withdraw at any time (Article 6(1)(a)) | Your consent (sections 11(1)(a) and 69) |

Where we rely on legitimate interests, you can object (section 9).

No law requires you to give us personal information. You need to give the details in section 3.4 only if you want a trial or a licence, and Paddle's checkout details only if you want to buy.

## 5. Who else handles your information

- **Cloudflare, Inc.** (United States) hosts our website and web app (Cloudflare Pages), runs our licensing service and its database (Cloudflare Workers and Durable Objects), serves our downloads (Cloudflare R2) and forwards support email (Cloudflare Email Routing). It acts for us under its data processing terms. It also uses connection data under its own privacy policy to protect its network from attacks.
- **Google LLC** (United States) provides the mailbox (Gmail) where support email arrives.
- **Paddle** sells KerfDesk Pro as reseller and merchant of record, under its own privacy notice (section 3.5). We give Paddle order numbers when we ask it to refund an order or to help with a request.
- **Professional advisers**, such as an accountant or lawyer, who must keep it confidential.
- **Courts, regulators, and tax or law enforcement authorities**, when the law requires.
- **A new owner of KerfDesk.** If the business moves to a company that Johannes Stephanus Stolk controls, or to a buyer, your information goes with it and stays protected as this policy describes.

## 6. Where your information goes

We are in South Africa. Our providers work in other countries:

- Cloudflare runs our services from its data centres around the world. Our licensing database is stored in a Cloudflare location outside South Africa, because Cloudflare does not offer this kind of storage in Africa.
- Google keeps email in its data centres, which are in the United States and other countries.
- Paddle is based in the United Kingdom, with companies in the United States, Canada and Ireland.

How we protect it:

- **If you are in South Africa:** these countries' laws may not protect personal information as strongly as POPIA does. We send it there because it is needed to provide what you asked for, such as your licence or an answer to your question about a purchase or licence (POPIA section 72(1)(c)), or, for other emails, because it is for your benefit and we cannot practicably ask your consent first (section 72(1)(e)). Cloudflare is bound by written data protection terms, and Cloudflare and Google take part in the EU–US Data Privacy Framework. Paddle collects its checkout information itself.
- **If you are in the European Economic Area (the EU, Iceland, Liechtenstein and Norway) or the UK:** information you send us yourself, from the app or by email, is collected directly by us, a business based in South Africa. The EU and UK have not recognised South Africa's law as giving equal protection: there is no “adequacy decision”. When our providers handle it for us, we rely on these safeguards: for Cloudflare, the EU Standard Contractual Clauses and the UK Addendum in its data processing terms, and its certification under the EU–US Data Privacy Framework and its UK extension; for support email held by Google in the United States, Google's certification under the EU–US Data Privacy Framework and its UK extension. Paddle sends us order information under the EU Standard Contractual Clauses and the UK Addendum in its data-sharing terms. Email us for a copy of these safeguards.

## 7. How long we keep it

| Information | How long we keep it |
| --- | --- |
| Your licence, its active computers, and the orders that bought or extended it | As long as the licence exists, because a licence you keep for good needs them to activate new computers. We delete them sooner if you ask (section 9). |
| A licence cancelled after a refund or chargeback, with its computers and orders | 2 years after cancellation. We delete them sooner if you ask (section 9). |
| Computers you have deactivated | Deleted within 90 days after deactivation. |
| Trial records (the keyed hash of the installation code, the device label and the trial dates) | Deleted 3 years after the trial ends. We keep them so that each Windows installation gets one trial. |
| Orders that were never paid, or whose checkout failed | Deleted within 90 days. |
| Records of payments the service refused | 5 years after we submit the tax return that covers the payment. |
| Our accounting records of each sale (only what our accounts need, such as the order number, date, product, price, tax and country) | 5 years after we submit the tax return that covers the sale, as South Africa's Tax Administration Act (section 29) requires. |
| Records of our administrative actions | 5 years after the action. |
| Backup copies of the licensing database | Up to 90 days. Newer backups replace older ones, so information we delete at your request is gone from our backups within 90 days. |
| Support emails and their attachments, including support reports | 2 years after our last exchange with you. |
| Cloudflare's email activity log (the sender, recipient and subject of each email to our support address) | 31 days, set by Cloudflare. |
| IP addresses | Not kept in our records. Cloudflare keeps its own short-term logs under its own policies. |
| Paddle's records of your order | Paddle decides, under its privacy notice. |
| Information on your computer | Until you delete it. |

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
- **Other companies.** Apart from Paddle's checkout on our checkout page (section 3.5), and Cloudflare's security processing (section 3.1), no other company collects information about your online activities through our website or apps.
- **Nevada.** We do not sell personal information. You can still send a request not to sell to our designated address, support@kerfdesk.com.

## 10. Decisions made by computer

We make no decisions about you by computer alone that have legal or similarly significant effects. Our licensing service applies the licence rules automatically: one trial per Windows installation, up to three active computers, a limit on how often a licence moves between computers, and refusing a payment that does not match its order. If you think it got something wrong, email us and a person will review it.

## 11. Cookies and similar technology

- Our pages set no cookies. We use no analytics, advertising or social media cookies.
- The web app and desktop app store working data on your device (section 3.2), because they need it to work. It stays on your device.
- Cloudflare, which delivers our pages, may set a strictly necessary security cookie (such as __cf_bm or cf_clearance) when it needs to check that a visitor is not an automated attack.
- On our checkout page, Paddle's checkout may set cookies or use similar storage to take the payment and prevent fraud. See Paddle's privacy notice.
- The licensed Windows app's update component saves its random update ID on your computer (section 3.3).

## 12. Children

KerfDesk is for adults. It is not aimed at children, and we do not knowingly collect personal information from anyone under 13, or from anyone under 18 without a parent's or guardian's consent. If you think a child has sent us personal information, email us and we will delete it.

## 13. Marketing

We do not send marketing emails, text messages or calls. We will send marketing only if you ask for it, and every message will let you stop it. We email customers only about their order, licence, refund, support request or security, or about a significant change to this policy or our terms (section 14).

## 14. Changes to this policy

When we change this policy, we will post the new version here with a new date and a summary of what changed. If a change significantly affects how we use information we already hold about you, we will tell you before it applies: on this page and, if we have your email address, by email. Ask us for a copy of any earlier version.

## 15. Contact

Johannes Stephanus Stolk, trading as KerfDesk
[PLACEHOLDER: physical street address], South Africa
Email: support@kerfdesk.com
Telephone: [PLACEHOLDER: telephone number]
Website: https://kerfdesk.com
