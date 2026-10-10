// Privacy. Two parts: this static website, and the KerfDesk app. Every network
// claim is grounded in the app source (public/_headers, vite.config.ts,
// electron/main.ts, electron/preview-update.ts, electron/commercial-update.ts,
// electron/licensing-*.ts, electron/auto-update.ts, electron/rtsp-camera-bridge.ts,
// electron/camera-frame-proxy*.ts, electron/private-network-host-policy.ts,
// src/platform/web/web-camera.ts, src/platform/electron/preview-updates.ts), in
// ADR-523 and docs/desktop-commercial-business-decisions.md section 4 (what
// licensing sends), or in website/lib/meta-files.mjs. This factual published
// notice is separate from the full review draft and does not certify compliance.

import { callout, featureGrid, pageHero, section, statusPill, table } from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import { remotePrivacy } from '../lib/remote-privacy.mjs';
import { publicSellerContact } from '../lib/legal-publication.mjs';
import { aiPrivacy } from '../lib/ai-privacy.mjs';

const AT_A_GLANCE = [
  {
    icon: 'cookie',
    title: 'No cookies on this site',
    body: 'This website sets no cookies and runs no analytics, scripts or ads.',
  },
  {
    icon: 'user-x',
    title: 'No account required',
    body: 'Ordinary desktop use needs no account. Pro licensing sends the few details below. Optional phone and MCP access needs your approval on the computer.',
  },
  {
    icon: 'eye-off',
    title: 'No telemetry',
    body: 'The app has no analytics, no automatic error reporting and no cloud sync. A support report is a file you save and send yourself.',
  },
  {
    icon: 'hard-drive',
    title: 'Your work stays with you',
    body: 'Saved projects and jobs stay on your computer. Optional AI sends only the request you review. Approved remote clients receive summaries and edits; a separate opt-in allows artwork previews and text, as described below.',
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
      'The desktop app confirms a saved trial or license',
      site.licensingHost,
      'At startup and every 30 minutes while open, the app checks whether a quiet weekly license confirmation is due. When due, it sends the installation digest and saved credential. No project, design, machine or job details.',
    ],
    [
      'You open the separate Buy Pro page or check a saved purchase',
      site.licensingHost,
      'A request checking whether purchases are available. Checking a saved purchase also sends its order reference and secret claim credential kept in this browser. This does not activate a phone or use a computer seat; no installation digest, project, design, machine or job details are sent.',
    ],
    [
      'The unsigned Windows edition checks for updates',
      site.downloadHost,
      'At startup and every 30 minutes while open, a request for the list of released versions. It also checks when you choose Check for Updates. An installer downloads only when you choose Download; installation starts only after you choose Install and close KerfDesk. No project, design, machine or job details.',
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
    [
      'You enable approved phone or MCP access',
      'kerfdesk-phone-control.cisgz3a.workers.dev (Cloudflare)',
      'An authenticated connection carries approved requests and bounded workspace, machine and recipe summaries. Separate artwork-sharing opt-in allows PNG previews and text contents. Access starts turned off, and each client needs your approval. See below for permissions, cookies and retention.',
    ],
    [
      'You choose Request draft in the optional desktop AI assistant',
      'api.openai.com (OpenAI)',
      'The reviewed prompt, dimensions and task; for material requests, the listed candidate recipe names/descriptions and any photograph you select. Your API key authenticates the request. No open project, canvas, machine settings or toolpaths are attached. See below for storage and provider handling.',
    ],
    [
      'You explicitly connect a FluidNC network machine in the desktop app',
      'The IP address or hostname and Telnet port you enter',
      'Controller commands and responses use that configured TCP channel. There is no network scan or automatic reconnect. The channel is not encrypted; use a trusted network.',
    ],
  ];
}

function websitePart(site, appPrivacy) {
  return html`<div class="prose">
    <p>
      ${appPrivacy
        ? 'This privacy page is a plain document. It has:'
        : 'This site is a set of plain pages. It has:'}
    </p>
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
      use, the page you asked for and the time. That is how the page gets to you.
      ${appPrivacy
        ? 'This privacy page adds no tracking of its own.'
        : 'This site adds no tracking of its own.'}
    </p>
    <h3>Links to other sites</h3>
    <p>
      ${appPrivacy
        ? 'Links on this page open other KerfDesk pages:'
        : 'Links that leave this site go to kerfdesk.com:'}
      the KerfDesk app, its download page, its support page and its notices.
      <a href="#app">Part 2</a> covers the app. The download page serves installers from
      ${site.downloadHost}. Your browser may tell the next site that you came from here, but not
      which page. The optional AI section also links to OpenAI’s API data policy.
    </p>
    <h3>Download statistics</h3>
    <p>
      For installer downloads from ${site.downloadHost}, the owner can view aggregate request
      estimates from Cloudflare, grouped by date, app version, platform and request country. The
      country is estimated from the request's network address; VPNs and proxies can show another
      country, so it does not establish where a person lives. These figures include repeat requests
      and partial downloads; they do not identify people or prove an installation. The owner's local
      dashboard saves only these aggregate figures, not IP addresses, device identifiers or licence
      details. This adds no tracking script or cookie to this site or the app.
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

function previewCheck(site, appPrivacy) {
  return html`<h3>The desktop Preview’s update check</h3>
    <p>
      When you open a
      <a href="${appPrivacy ? site.downloadPageUrl : '/download/'}">desktop Preview</a>, it makes
      one small request to ${site.downloadHost} to ask whether a newer Preview exists. It sends no
      project, design, machine, job or device ID, and no token, cookies or referrer. It identifies
      itself only with a generic “KerfDesk-Desktop-Preview” user agent. ${site.downloadHost} still
      sees normal connection details, such as your IP address and the time. If you’re offline or the
      check fails, nothing happens. The web app never makes this check.
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

function licensing(site, appPrivacy) {
  return html`<h3 id="licensing">Pro trials and licenses</h3>
    <p>
      When you start a Pro trial, or activate or move a license, the KerfDesk desktop app contacts
      the KerfDesk licensing service at ${site.licensingHost}. The Free browser workspace has no
      license and does not contact this service. The separate Buy Pro page is described below. The
      desktop app sends only:
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
    <p>
      The desktop app also quietly confirms saved trial or license rights about once a week. It
      checks whether that confirmation is due at startup and every 30 minutes while open, using the
      same installation digest and saved credential. A failed connection does not interrupt your
      work; the app continues to enforce the signed trial expiry on your computer.
    </p>
    <h3>Buying Pro</h3>
    <p>
      Purchase isn’t open yet, and ${appPrivacy ? 'this privacy page' : 'this website'} has no
      checkout. When purchase opens, payments will be handled by Paddle, the payment provider, as
      merchant of record and authorised reseller: you purchase from Paddle, while KerfDesk provides
      the software and licence. Paddle processes the payment and your customer record under
      <a href="https://www.paddle.com/legal/privacy">its own privacy notice</a>.
    </p>
    <p>
      The separate Buy Pro page contacts ${site.licensingHost} to check whether purchases are
      available. Checking a saved purchase sends its order reference and secret claim credential,
      kept in this browser's local storage. When purchase opens, creating an order sends a random
      request identifier so a retry can recover the same order. These requests send no installation
      digest, projects, designs, machine details or jobs, and do not activate a phone or use a
      computer seat. Requests use no cookies. Clearing browser storage can remove the information
      needed to recover an unfinished purchase.
    </p>
    <h3>Your licence key by email</h3>
    <p>
      Once Paddle confirms a purchase, the licensing service can email your licence key to the
      address you gave Paddle. It asks Paddle for that address only to send this one email, sends it
      through Cloudflare's email service from a kerfdesk.com address, and does not store, log or
      reuse it; the order records only whether the email was sent. Renewals send no key email. This
      is prepared but not yet switched on; until it is, Paddle's receipt is the only email a
      purchase sends.
    </p>
    <h3>Pasting your licence key</h3>
    <p>
      The desktop app reads your clipboard only when you choose Paste key in Help &gt; Licence, or
      when the purchase page's Copy key &amp; open KerfDesk opens it. It takes only a KerfDesk
      licence key from the clipboard and ignores everything else. The key leaves your computer only
      when you choose Activate licence. The kerfdesk://licence link that opens the app carries no
      key or other data.
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
        <strong>Your machine.</strong> For USB, you pick your machine’s port when you click Connect.
        The desktop app also supports an explicitly configured FluidNC Telnet channel. Machine
        commands go to the port or network address you choose. These connections do not upload a
        project to a KerfDesk service.
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

function appPart(site, appPrivacy) {
  return html`<div class="prose">
      <p>
        KerfDesk runs on your computer, in your browser or as a desktop app, with no account and no
        cloud sync. Here is what the app keeps on your computer, and when it goes online.
      </p>
      ${storedLocally()}
      <h3>What goes over the network</h3>
      <p>
        Automatic update and licensing requests do not send projects, designs, machine details or
        jobs. Optional AI, remote access, cameras and network machines make the user-requested
        connections described below. Each service still sees ordinary connection details, such as
        your IP address and the time.
      </p>
    </div>
    ${table({
      caption: 'Automatic and user-requested connections',
      head: ['When', 'Where it goes', 'What happens'],
      rows: connections(site),
    })}
    <div class="prose">
      ${previewCheck(site, appPrivacy)} ${licensing(site, appPrivacy)} ${remotePrivacy()}
      ${aiPrivacy()} ${cameraHelper()} ${deviceAccess()}
      ${callout({
        iconName: 'wifi-off',
        title: 'Working offline',
        body: html`<p>
          After your first visit, the web app keeps working with no internet connection. Design,
          preview and machine control all run on your computer. Optional AI requests need internet
          access. Lesson and CNC bit pictures you haven’t viewed yet need a connection. Running a
          machine with the network switched off is confirmed in software but hasn’t been tested on a
          real machine yet. The desktop app runs from files installed on your computer.
        </p>`,
      })}
    </div>`;
}

function questions(site) {
  return html`<div class="prose">
    <p>
      Have a question about privacy, or think something on this page is wrong? Email
      <a href="mailto:${site.supportEmail}">${site.supportEmail}</a> or use the
      <a href="${site.supportUrl}">KerfDesk support page</a>. If you’ve found a security problem,
      please don’t post the details anywhere public.
    </p>
    <p>The date at the top of this page shows when it last changed.</p>
  </div>`;
}

export const page = {
  path: '/privacy/',
  nav: null,
  title: 'Privacy',
  description:
    'KerfDesk needs no account for ordinary use. Read about updates, licensing, downloads, optional AI, remote access and machine connections.',
  render: ({ site, appPrivacy = false }) =>
    html`${pageHero({
      eyebrow: html`Last updated <time datetime="2026-10-10">October 10, 2026</time>`,
      title: 'Privacy',
      lead: appPrivacy
        ? 'KerfDesk doesn’t track you. This notice covers this privacy page and the KerfDesk app: what each one sends over the network, and what stays on your computer.'
        : 'KerfDesk doesn’t track you. This page covers this website and the KerfDesk app: what each one sends over the network, and what stays on your computer.',
    })}
    ${section({
      content: featureGrid(
        appPrivacy
          ? AT_A_GLANCE.map((item, index) =>
              index === 0
                ? {
                    ...item,
                    title: 'No cookies on this page',
                    body: 'This privacy page sets no cookies and runs no analytics, scripts or ads.',
                  }
                : item,
            )
          : AT_A_GLANCE,
        { columns: 4 },
      ),
    })}
    ${section({
      id: 'website',
      tone: 'alt',
      narrow: true,
      eyebrow: 'Part 1',
      title: appPrivacy ? 'This privacy page' : 'This website',
      content: websitePart(site, appPrivacy),
    })}
    ${section({
      id: 'app',
      narrow: true,
      eyebrow: 'Part 2',
      title: 'The KerfDesk app',
      content: appPart(site, appPrivacy),
    })}
    ${section({
      id: 'controller',
      narrow: true,
      title: 'Who is responsible for your information',
      content: publicSellerContact({ privacy: true }),
    })}
    ${section({
      id: 'questions',
      tone: 'alt',
      narrow: true,
      title: 'Questions',
      content: questions(site),
    })}`,
};
