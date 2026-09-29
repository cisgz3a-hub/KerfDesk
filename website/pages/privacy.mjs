// Privacy. Two parts: this static website, and the KerfDesk app. Every network
// claim is grounded in the app source on main (public/_headers, vite.config.ts,
// electron/main.ts, electron/preview-update.ts, electron/auto-update.ts,
// electron/rtsp-camera-bridge.ts, electron/camera-frame-proxy*.ts,
// electron/private-network-host-policy.ts, src/platform/web/web-camera.ts) or
// in website/lib/meta-files.mjs.

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
    body: 'KerfDesk has no sign-up, sign-in or activation, so there is no account data to collect.',
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
// electron/rtsp-camera-bridge.ts and electron/camera-frame-proxy*.ts. The
// Download update link is user-initiated, so it is covered in previewCheck().
const CONNECTIONS = [
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
    'GitHub',
    'One anonymous request asking whether a newer Preview exists. See below.',
  ],
  [
    'You open the Camera panel or use a network camera in the desktop Preview',
    'A helper on your own computer, and cameras on your private network',
    'Requests for camera pictures. They stay on your local network. See below.',
  ],
];

function websitePart() {
  return html`<div class="prose">
    <p>This site is a set of plain pages. It has:</p>
    <ul>
      <li>no cookies</li>
      <li>no analytics or visitor tracking</li>
      <li>no scripts</li>
      <li>no forms or sign-ups</li>
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
      Some links take you to GitHub, where KerfDesk’s desktop downloads, issue tracker and private
      security reporting live. Once you follow one, you’re on GitHub, and GitHub’s own privacy terms
      apply. Other links open the KerfDesk app at kerfdesk.com, which
      <a href="#app">Part 2</a> covers. Your browser may tell the next site that you came from here,
      but not which page.
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
      When you open a <a href="/download/">desktop Preview</a>, it makes one small request to GitHub
      to ask whether a newer Preview exists. It sends no project, design, machine, job or device ID,
      and no token, cookies or referrer. It identifies itself only with a generic
      “KerfDesk-Desktop-Preview” user agent. GitHub still sees normal connection details, such as
      your IP address and the time. If you’re offline or the check fails, nothing happens. The web
      app never makes this check.
    </p>
    <p>
      If a newer Preview exists, a small Download update link appears in the status bar. KerfDesk
      never downloads or installs anything on its own. The link opens that version’s page among
      <a href="${site.releasesUrl}">KerfDesk’s releases on GitHub</a> in your browser, and you
      install it yourself.
    </p>
    <p>
      ${statusPill('shipped-code-and-tests')} Automated tests cover this check. It hasn’t yet been
      checked on installed copies on real computers.
    </p>`;
}

function cameraHelper() {
  return html`<h3>The camera helper</h3>
    <p>
      Network cameras are available only in the desktop Preview. To reach them, the Preview starts a
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
        KerfDesk runs on your computer, in your browser or as a desktop Preview, with no account and
        no cloud sync. Here is what the app keeps on your computer, and when it goes online.
      </p>
      ${storedLocally()}
      <h3>What goes over the network</h3>
      <p>
        These are the only connections KerfDesk is built to make on its own. None of them sends your
        projects, designs, machine details or jobs. Like any website, kerfdesk.com still sees
        ordinary connection details, such as your IP address and the time.
      </p>
    </div>
    ${table({
      caption: 'Connections KerfDesk makes on its own',
      head: ['When', 'Where it goes', 'What happens'],
      rows: CONNECTIONS,
    })}
    <div class="prose">
      ${previewCheck(site)} ${cameraHelper()} ${deviceAccess()}
      ${callout({
        iconName: 'wifi-off',
        title: 'Working offline',
        body: html`<p>
          After your first visit, the web app keeps working with no internet connection. Design,
          preview and machine control all run on your computer. Lesson and CNC bit pictures you
          haven’t viewed yet need a connection. Running a machine with the network switched off is
          confirmed in software but hasn’t been tested on a real machine yet. The desktop Preview
          runs from files installed on your computer.
        </p>`,
      })}
    </div>`;
}

function questions(site) {
  return html`<div class="prose">
    <p>
      Have a question about privacy, or think something on this page is wrong?
      <a href="${site.issuesUrl}">Open an issue on GitHub</a>. Issues are public, so please leave
      out personal details, and look over a diagnostic file before you attach one.
    </p>
    <p>
      To report a security problem, use
      <a href="${site.securityReportUrl}">GitHub’s private reporting</a> instead of a public issue.
    </p>
    <p>The date at the top of this page shows when it last changed.</p>
  </div>`;
}

export const page = {
  path: '/privacy/',
  nav: null,
  title: 'Privacy',
  description:
    'KerfDesk has no account, analytics or cloud sync, and this site sets no cookies. See what the site and the app send over the network.',
  render: ({ site }) =>
    html`${pageHero({
      eyebrow: html`Last updated <time datetime="2026-09-23">September 23, 2026</time>`,
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
      content: websitePart(),
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
