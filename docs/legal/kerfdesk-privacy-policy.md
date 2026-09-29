# KerfDesk Privacy Policy

> Published at https://kerfdesk.com/privacy/ as the first part of that page, followed by
> `kerfdesk-privacy-notice.md` (licensing and purchases). `scripts/generate-site-pages.mjs` builds
> the page; blockquotes like this one are never published. The network facts come from
> `website/pages/privacy.mjs`, which cites the app source. Keep the two consistent.

Last updated: 29 September 2026.

This policy covers kerfdesk.com, the KerfDesk web app and the KerfDesk desktop app: what each one
sends over the network, and what stays on your computer. The licensing and purchases part below
covers Pro trials, licences and buying Pro, and says who we are and what your rights are.

## At a glance

- **No account.** KerfDesk has no sign-up or sign-in.
- **No tracking.** KerfDesk has no analytics, telemetry, automatic error reporting or advertising,
  and it sets no cookies.
- **Your work stays with you.** Your projects, machine details and jobs stay on your computer.
  KerfDesk does not upload them.

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

The pricing, download, support and policy pages on kerfdesk.com set no cookies and run no analytics
or advertising. The download page runs a script that checks the publisher's signature on the list of
desktop releases from dl.kerfdesk.com before it shows a download link. Like any website, our web
server receives your IP address, which browser you use, the page you asked for and the time. We add
no tracking of our own. The checkout page, where you pay for Pro, loads Paddle's code, as the
licensing and purchases part below explains.
