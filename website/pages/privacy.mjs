// Privacy. Two parts: this static website, and the KerfDesk app. Every network
// claim is grounded in the app source (public/_headers, vite.config.ts,
// electron/main.ts, electron/preview-update.ts, electron/commercial-update.ts,
// electron/licensing-*.ts, electron/auto-update.ts, electron/rtsp-camera-bridge.ts,
// electron/camera-frame-proxy*.ts, electron/private-network-host-policy.ts,
// src/platform/web/web-camera.ts, src/platform/electron/preview-updates.ts), in
// ADR-523 and docs/desktop-commercial-business-decisions.md section 4 (what
// licensing sends), or in website/lib/meta-files.mjs. The formal privacy notice
// for purchases is written separately; this page doesn't replace it.

import { callout, featureGrid, pageHero, section, statusPill, table } from '../lib/components.mjs';
import { html } from '../lib/html.mjs';

const AT_A_GLANCE = [
  {
    icon: 'cookie',
    title: 'No cookies on this site',
    body: 'This website sets no cookies and runs no analytics, scripts or ads.',
  },
  {
    icon: 'user-x',
    title: 'No account',
    body: 'KerfDesk has no sign-up or sign-in. A Pro trial or license sends only the few licensing details listed below.',
  },
  {
    icon: 'eye-off',
    title: 'No telemetry',
    body: 'The app has no analytics, no error reporting and no cloud sync.',
  },
  {
    icon: 'hard-drive',
    title: 'Your work stays with you',
    body: 'Your projects, machine details and jobs stay on your computer. KerfDesk doesn’t upload them.',
  },
];

// When / where it goes / what happens. Sources: public/_headers (web CSP and
// sw.js revalidation), vite.config.ts (prompt-only updates; lesson and bit
// pictures cached on demand for 30 days), electron/preview-update.ts,
// electron/licensing-*.ts, electron/commercial-update.ts,
// electron/rtsp-camera-bridge.ts and electron/camera-frame-proxy*.ts. The
// Download update link is user-initiated, so it is covered in previewCheck().
function connections(site) {
  return [
    [
      'You open the web app',
      'kerfdesk.com',
      'Your browser downloads the app’s files on your first visit. After that, each time you open it online, it makes a small check for a newer version and downloads the new files if there is one. A new version waits until you click Update in the status bar, or until every KerfDesk tab is closed.',
    ],
    [
      'You open a lesson, or show a CNC bit picture, in the web app',
      'kerfdesk.com',
      'Your browser downloads that picture and keeps a copy for up to 30 days.',
    ],
    [
      'You start the desktop Preview',
      site.downloadHost,
      'One anonymous request asking whether a newer Preview exists. See below.',
    ],
    [
      'You start a Pro trial, or activate or move a license',
      site.licensingHost,
      'Only the licensing details listed below. See below.',
    ],
    [
      'The signed Windows edition checks for updates',
      site.downloadHost,
      'Requests for the list of released versions and, when a newer one your license covers exists, its update files. No project, design, machine or job details.',
    ],
    [
      'You open the Camera panel or use a network camera in the desktop app',
      'A helper on your own computer, and cameras on your private network',
      'Requests for camera pictures. They stay on your local network. See below.',
    ],
  ];
}

function websitePart(site) {
  return html`<div class="prose">
    <p>This site is a set of plain pages. It has:</p>
    <ul>
      <li>no cookies</li>
      <li>no analytics or visitor tracking</li>
      <li>no scripts</li>
      <li>no forms, sign-ups or checkout</li>
      <li>no ads, videos, maps or other content embedded from other sites</li>
    </ul>
    <p>
      Its pictures, styles and icons all come from this site. Its security policy blocks every
      script and form, and anything loaded from another site.
    </p>
    <h3>What the server receives</h3>
    <p>
      Like any website, this one is delivered by a web server. Each time your browser asks for a
      page, it sends the standard details every site receives: your IP address, which browser you
      use, the page you asked for and the time. That is how the page gets to you. This site adds no
      tracking of its own.
    </p>
    <h3>Links to other sites</h3>
    <p>
      Links that leave this site go to kerfdesk.com: the KerfDesk app, its download page, its
      support page and its notices. <a href="#app">Part 2</a> covers the app. The download page
      serves installers from ${site.downloadHost}. Your browser may tell the next site that you came
      from here, but not which page.
    </p>
  </div>`;
}

function storedLocally() {
  return html`<h3>What stays on your computer</h3>
    <ul>
      <li>
        <strong>Your projects.</strong> You save them as files on your computer, in the place you
        choose. To open or import a file, you pick it yourself or drop it in.
      </li>
      <li>
        <strong>Working data.</strong> To protect your work, KerfDesk keeps an autosaved copy of
        your open project, your material libraries, your settings, your lesson progress and a
        checkpoint for resuming an interrupted job. These live in the app’s own storage on this
        computer. In a browser, clearing the site data for kerfdesk.com removes them.
      </li>
      <li>
        <strong>Diagnostic files.</strong> If you need help, the Export machine diagnostic command
        saves a file with your machine profile, controller settings and recent serial log. It is
        saved on your computer, and KerfDesk doesn’t upload it. You decide whether to share it.
      </li>
    </ul>`;
}

function previewCheck(site) {
  return html`<h3>The desktop Preview’s update check</h3>
    <p>
      When you open a <a href="/download/">desktop Preview</a>, it makes one small request to
      ${site.downloadHost} to ask whether a newer Preview exists. It sends no project, design,
      machine, job or device ID, and no token, cookies or referrer. It identifies itself only with a
      generic “KerfDesk-Desktop-Preview” user agent. ${site.downloadHost} still sees normal
      connection details, such as your IP address and the time. If you’re offline or the check
      fails, nothing happens. The web app never makes this check.
    </p>
    <p>
      If a newer Preview exists, a small Download update link appears in the status bar. KerfDesk
      never downloads or installs a Preview on its own. The link opens the
      <a href="${site.downloadPageUrl}">KerfDesk download page</a> for that version in your browser,
      and you install it yourself.
    </p>
    <p>
      ${statusPill('shipped-code-and-tests')} Automated tests cover this check. It hasn’t yet been
      checked on installed copies on real computers.
    </p>`;
}

function licensing(site) {
  return html`<h3 id="licensing">Pro trials and licenses</h3>
    <p>
      When you start a Pro trial, or activate or move a license, the KerfDesk desktop app contacts
      the KerfDesk licensing service at ${site.licensingHost}. The web app has no license and never
      contacts it. The desktop app sends only:
    </p>
    <ul>
      <li>
        an installation digest: a one-way hash of your operating system’s installation ID, worked
        out on your computer, so the ID itself never leaves it
      </li>
      <li>a generic device label, such as “win32 computer”, not your computer’s name</li>
      <li>your license key or credential</li>
      <li>the order details that match a license to its purchase</li>
    </ul>
    <p>
      It never uploads your projects, drawings, toolpaths, or machine or job data. Licensing adds no
      analytics, cookies or tracking. Like any web service, ${site.licensingHost} still sees normal
      connection details, such as your IP address and the time.
    </p>
    <h3>Buying Pro</h3>
    <p>
      Purchase isn’t open yet, and this website has no checkout. When purchase opens, payments will
      be handled by Paddle, the payment provider, as merchant of record. Paddle processes the
      payment and your customer record under its own privacy notice.
    </p>`;
}

function cameraHelper() {
  return html`<h3>The camera helper</h3>
    <p>
      Network cameras are available only in the desktop app. To reach them, the desktop app starts a
      small camera helper that listens only on your own computer, at 127.0.0.1 port 51731. It
      fetches pictures from cameras on your private network and passes them to the app. It connects
      only to addresses on your computer or your private network, never to the internet. When you
      open the Camera panel, it looks for a machine’s built-in camera at four fixed addresses on
      your local network.
    </p>
    <p>
      The web app’s security policy lets it connect only to kerfdesk.com and to that one address on
      your own computer. It loads no third-party scripts.
    </p>`;
}

function deviceAccess() {
  return html`<h3>Your machine and USB cameras</h3>
    <ul>
      <li>
        <strong>Your machine.</strong> KerfDesk connects to your machine over a USB cable. When you
        click Connect, you pick your machine’s port from a list. Machine commands go over that
        cable, not over the internet or Wi-Fi.
      </li>
      <li>
        <strong>USB cameras.</strong> In a browser, KerfDesk can use a camera only after you allow
        it. KerfDesk asks for video only, never sound, and the picture stays on your computer.
      </li>
    </ul>
    <p>
      In a browser, these permissions belong to kerfdesk.com. You can review or remove them in your
      browser’s site settings at any time.
    </p>`;
}

function appPart(site) {
  return html`<div class="prose">
      <p>
        KerfDesk runs on your computer, in your browser or as a desktop app, with no account and no
        cloud sync. Here is what the app keeps on your computer, and when it goes online.
      </p>
      ${storedLocally()}
      <h3>What goes over the network</h3>
      <p>
        These are the only connections KerfDesk is built to make on its own. None of them sends your
        projects, designs, machine details or jobs. Each service still sees ordinary connection
        details, such as your IP address and the time.
      </p>
    </div>
    ${table({
      caption: 'Connections KerfDesk makes on its own',
      head: ['When', 'Where it goes', 'What happens'],
      rows: connections(site),
    })}
    <div class="prose">
      ${previewCheck(site)} ${licensing(site)} ${cameraHelper()} ${deviceAccess()}
      ${callout({
        iconName: 'wifi-off',
        title: 'Working offline',
        body: html`<p>
          After your first visit, the web app keeps working with no internet connection. Design,
          preview and machine control all run on your computer. Lesson and CNC bit pictures you
          haven’t viewed yet need a connection. Running a machine with the network switched off is
          confirmed in software but hasn’t been tested on a real machine yet. The desktop app runs
          from files installed on your computer.
        </p>`,
      })}
    </div>`;
}

function questions(site) {
  return html`<div class="prose">
    <p>
      Have a question about privacy, or think something on this page is wrong? Use the
      <a href="${site.supportUrl}">KerfDesk support page</a>. A support email address is being set
      up and will be listed there. If you’ve found a security problem, please don’t post the details
      anywhere public.
    </p>
    <p>The date at the top of this page shows when it last changed.</p>
  </div>`;
}

export const page = {
  path: '/privacy/',
  nav: null,
  title: 'Privacy',
  description:
    'KerfDesk has no account, analytics or cloud sync, and this site sets no cookies. See what the site and the app send, including for Pro licensing.',
  render: ({ site }) =>
    html`${pageHero({
      eyebrow: html`Last updated <time datetime="2026-09-29">September 29, 2026</time>`,
      title: 'Privacy',
      lead: 'KerfDesk doesn’t track you. This page covers this website and the KerfDesk app: what each one sends over the network, and what stays on your computer.',
    })}
    ${section({ content: featureGrid(AT_A_GLANCE, { columns: 4 }) })}
    ${section({
      id: 'website',
      tone: 'alt',
      narrow: true,
      eyebrow: 'Part 1',
      title: 'This website',
      content: websitePart(site),
    })}
    ${section({
      id: 'app',
      narrow: true,
      eyebrow: 'Part 2',
      title: 'The KerfDesk app',
      content: appPart(site),
    })}
    ${section({
      id: 'questions',
      tone: 'alt',
      narrow: true,
      title: 'Questions',
      content: questions(site),
    })}`,
};
