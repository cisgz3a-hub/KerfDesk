# KerfDesk Privacy Policy

> Published at https://kerfdesk.com/privacy/ as the first part of that page, followed by
> `kerfdesk-privacy-notice.md` (licensing and purchases). `scripts/generate-site-pages.mjs` builds
> the page; blockquotes like this one are never published. The network facts come from
> `website/pages/privacy.mjs`, which cites the app source. Keep the two consistent. Claude checked
> this part against POPIA, the EU and UK GDPR, US state law and Paddle's rules on 29 September 2026
> (`privacy-policy-legal-check.md`, ADR-247 Amendment 2); re-check it after any change.

Last updated: 29 September 2026.

This policy covers kerfdesk.com, the KerfDesk web app and the KerfDesk desktop app: what each one
sends over the network, what stays on your computer, and why. The licensing and purchases part below
covers Pro trials, licences and buying Pro.

## At a glance

- **No account.** KerfDesk has no sign-up or sign-in.
- **No tracking.** KerfDesk has no analytics, telemetry, automatic error reporting or advertising,
  and it sets no cookies of its own.
- **Your work stays with you.** Your projects, machine details and jobs stay on your computer.
  KerfDesk does not upload them.
- **Nothing sold.** We do not sell your personal information or share it for advertising.

## What stays on your computer

- **Your projects.** You save them as files on your computer, in the place you choose. To open or
  import a file, you pick it yourself or drop it in.
- **Working data.** To protect your work, KerfDesk keeps an autosaved copy of your open project,
  your material libraries, your settings, your lesson progress and a checkpoint for resuming an
  interrupted job. They live in the app's own storage on your computer. In a browser, clearing the
  site data for kerfdesk.com removes them.
- **Diagnostic files and support reports.** The Export machine diagnostic command and Help > Save
  Support Report save files on your computer. KerfDesk does not upload them. You decide whether to
  send them to anyone.

## What goes over the network

These are the only connections KerfDesk is built to make on its own. None of them sends your
projects, designs, machine details or jobs. Each service still sees ordinary connection details,
such as your IP address and the time.

- **Opening the web app, at kerfdesk.com.** Your browser downloads the app's files on your first
  visit. After that, each time you open it online, it checks for a newer version and downloads the
  new files if there is one. A new version waits until you click Update in the status bar, or until
  every KerfDesk tab is closed.
- **Lesson and CNC bit pictures in the web app, from kerfdesk.com.** Your browser downloads a picture
  when you first view it and keeps a copy for up to 30 days.
- **The desktop Preview's update check, at dl.kerfdesk.com.** One request asking whether a newer
  Preview exists. It sends no project, design, machine, job or device ID, and no token, cookies or
  referrer. KerfDesk never downloads or installs a Preview on its own.
- **The Windows desktop app's update check, at dl.kerfdesk.com.** Requests for the list of released
  versions and, when a newer one your licence covers exists, its update files.
- **Pro trials and licences in the desktop app, at license.kerfdesk.com.** Only the licensing
  details listed in the licensing and purchases part below. The web app never contacts this service.
- **Network cameras in the desktop app.** A camera helper that listens only on your own computer, at
  127.0.0.1 port 51731, fetches pictures from cameras on your private network. It connects only to
  your computer and your private network, never to the internet.

KerfDesk connects to your machine over a USB cable, and machine commands go over that cable, not
over the internet. In a browser, KerfDesk can use your machine's port or a USB camera only after you
allow it, and it asks a camera for video only, never sound. You can remove these permissions in your
browser's site settings at any time.

## Our web pages

The pricing, download, support and policy pages on kerfdesk.com set no cookies of their own and run
no analytics or advertising. The download page runs a script that checks the publisher's signature on the list of
desktop releases from dl.kerfdesk.com before it shows a download link. Like any website, our web
server receives your IP address, which browser you use, the page you asked for and the time. We add
no tracking of our own. The checkout page, where you pay for Pro, loads Paddle's code, as the
licensing and purchases part below explains.

If Cloudflare, which runs our servers, needs to check that a visitor is a person and not an
automated program, it may set a security cookie for that check alone.

## Why we use your information, and for how long

- **Connection details.** Every connection above, and every visit to our pages, gives our servers
  your IP address, your browser or app version, what you asked for and the time. We use them only
  to deliver what you asked for and to protect our services from attacks and abuse, which is our
  legitimate interest. Without them, the page, the app or the update cannot reach you. We keep no
  logs of these connections ourselves. Cloudflare handles them for us as our service provider and
  keeps them only as long as it needs them to deliver and protect our services. It shows us overall
  totals, such as how many requests our sites received and from which countries, and details only
  of requests it blocked or challenged to protect our sites.
- **Emails you send us.** When you email support@kerfdesk.com, we receive your email address and
  whatever you write or attach. We use them only to answer you, which is our legitimate interest,
  or to provide your licence under our agreement with you. We keep support messages for 2 years
  after our last exchange.

## Who else handles your information

- **Cloudflare, Inc.** runs kerfdesk.com, dl.kerfdesk.com and license.kerfdesk.com for us, and
  forwards email sent to support@kerfdesk.com.
- **Google** hosts the mailbox that receives our support email.
- **Paddle** takes payments on our checkout page, as the licensing and purchases part below
  explains.

We are in South Africa. Cloudflare and Google are based in the United States and handle
information in many countries. Both take part in the EU-U.S. Data Privacy Framework and its UK
extension, which the European Commission and the UK government recognise as protecting information
sent to the United States (https://www.dataprivacyframework.gov). Cloudflare also handles our
information under data processing terms that include the European Commission's standard
contractual clauses. You can ask us for a copy of those terms.

## Tracking signals and children

We do not track you over time or across other websites, and apart from Paddle on our checkout page,
no other company can use our pages or apps to do so. So we treat every visit the same way, whether
or not your browser sends a Do Not Track or Global Privacy Control signal.

KerfDesk is not directed at children, and we do not knowingly collect personal information from
anyone under 18. If you believe a child has sent us personal information, email
support@kerfdesk.com and we will delete it.

## Who is responsible, and your rights

Johannes Stephanus Stolk, of [PLACEHOLDER: physical address], South Africa, is responsible for your
information ("we", "us"). Contact us at support@kerfdesk.com.

You can ask to see the personal information we hold about you, and ask us to correct or delete it,
to limit how we use it, or to send it to you in a portable form. You can object to how we use it.
We may ask you to show that the information is yours, and we will reply within 30 days. If you are
not satisfied, you can complain to South Africa's Information Regulator
(https://inforegulator.org.za) or to the data protection authority where you live.

When this policy changes, we update this page and the date at the top.
