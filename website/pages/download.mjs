// Download page. The web app is the recommended path. Desktop installers come
// only from the KerfDesk download page (site.downloadPageUrl, public/download.html
// in the app), which serves them from dl.kerfdesk.com and checks the publisher
// signature on the release metadata before it shows a link. This site has no
// scripts, so it can't run that check or find the newest version itself: every
// desktop button opens that page, and the file names are given as patterns.
// No version number is hard-coded, and nothing links to GitHub: the source
// repository is private (ADR-524 Amendment 1).

import {
  actions,
  button,
  callout,
  ctaBand,
  faqList,
  featureGrid,
  pageHero,
  section,
  split,
  table,
} from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { shot } from '../lib/screens.mjs';
import {
  COMPANION_FILES,
  DESKTOP_FILES,
  downloadFaq,
  SAME_APP_POINTS,
  updateItems,
  WEB_APP_POINTS,
} from './download-data.mjs';

const [WINDOWS, MAC_INTEL, MAC_ARM] = DESKTOP_FILES;

function asset(name) {
  return html`<code class="asset">${name}</code>`;
}

function ticks(items) {
  return html`<ul class="ticks">
    ${items.map((item) => html`<li>${icon('check')}<span>${item}</span></li>`)}
  </ul>`;
}

function platforms(site) {
  return html`<div class="platforms">
    <article class="platform platform--featured">
      <span class="eyebrow">Recommended</span>
      <h3>${icon('globe')}Web app</h3>
      <p>Runs in Chrome, Edge, Brave or Arc on Windows, macOS or Linux.</p>
      ${ticks(WEB_APP_POINTS)}
      ${button(site.appUrl, 'Open the web app', { iconName: 'arrow-right' })}
    </article>
    <article class="platform">
      <span class="eyebrow">Preview or signed edition</span>
      <h3>${icon('monitor')}Windows</h3>
      <p>
        Windows 10 or 11, 64-bit (x64). The download page offers the unsigned Preview and, once it’s
        released, the signed Windows edition with in-app updates. Testing on real Windows PCs isn’t
        finished yet.
      </p>
      <p>Look for ${asset(WINDOWS.file)}</p>
      ${button(site.downloadPageUrl, 'Windows downloads', {
        variant: 'secondary',
        iconName: 'download',
      })}
    </article>
    <article class="platform">
      <span class="eyebrow">Unsigned, unnotarized Preview</span>
      <h3>${icon('laptop')}macOS</h3>
      <p>
        macOS 13 or newer, on Intel or Apple Silicon Macs. There is a separate disk image for each
        chip type. Testing on real Macs isn’t finished yet.
      </p>
      <p>Intel (x64): ${asset(MAC_INTEL.file)}</p>
      <p>Apple Silicon (arm64): ${asset(MAC_ARM.file)}</p>
      ${button(site.downloadPageUrl, 'Mac downloads', {
        variant: 'secondary',
        iconName: 'download',
      })}
    </article>
  </div>`;
}

function chooseSection(site) {
  return section({
    id: 'choose',
    eyebrow: 'Web or desktop',
    title: 'Choose how to run KerfDesk',
    lead: 'The web app is the quickest way to start. The desktop app packages the same app for Windows and macOS.',
    content: html`${platforms(site)}
    ${callout({
      iconName: 'package',
      title: 'Download the desktop app only from the KerfDesk download page',
      body: html`<p>
        Both desktop buttons open the
        <a href="${site.downloadPageUrl}">KerfDesk download page</a>, the only official place to get
        the desktop app. Every installer it offers is served from ${site.downloadHost}. Before it
        shows a download link, the page checks the publisher’s signature on the release, so it needs
        JavaScript turned on in your browser.
      </p>`,
    })}
    ${callout({
      iconName: 'globe',
      title: 'Using Linux?',
      body: html`<p>
        There is no Linux desktop app yet, and no date for one. Use the
        <a href="${site.appUrl}">web app</a> in Chrome or Edge. It has the same design and toolpath
        features as the desktop app, and you can install it from the browser.
      </p>`,
    })}`,
  });
}

function sameAppSection(ctx) {
  return section({
    tone: 'alt',
    content: split({
      title: 'One app, wherever you run it',
      body: 'The desktop app is built from the same code as the web app. Packaging doesn’t change any design, toolpath, G-code or machine-control behavior. A few extras exist only on the desktop, such as the network-camera helper and the update link.',
      points: SAME_APP_POINTS,
      media: shot(ctx, 'workspace'),
    }),
  });
}

function filesSection() {
  return section({
    id: 'desktop-files',
    narrow: true,
    eyebrow: 'Desktop files',
    title: 'Pick the right file',
    lead: 'The download page names each file. Download the one that matches your computer.',
    content: html`<div class="prose">
        <p>
          In each name below, <code>&lt;version&gt;</code> is the release tag without its leading
          <code>v</code>. For example, tag <code>v0.2.0-preview.1</code> becomes
          <code>0.2.0-preview.1</code>.
        </p>
      </div>
      ${table({
        caption: 'Desktop installer files',
        head: ['Computer', 'Needs', 'File'],
        rows: DESKTOP_FILES.map((row) => [row.computer, row.needs, asset(row.file)]),
      })}
      <div class="prose">
        <h3>Check what you downloaded</h3>
        <p>Every Preview also publishes three companion files:</p>
        <ul>
          ${COMPANION_FILES.map((item) => html`<li>${asset(item.file)}: ${item.body}</li>`)}
        </ul>
        <p>
          Each release also has a signed manifest that ties every file’s name, size and SHA-256
          checksum to its version. It shows the publisher approved those exact files. It isn’t an
          operating-system code signature, and it doesn’t make an unsigned build signed.
        </p>
      </div>`,
  });
}

function installSection() {
  return section({
    id: 'install',
    tone: 'alt',
    narrow: true,
    eyebrow: 'Unsigned Preview',
    title: 'Install a desktop Preview',
    lead: 'Desktop Previews are unsigned, and Mac Previews aren’t notarized by Apple. Windows or macOS may warn you the first time you open one.',
    content: html`${callout({
        title: 'Opening an unsigned app is your decision',
        body: html`<p>
          Choose <strong>Run anyway</strong> or <strong>Open Anyway</strong> only for a file you
          downloaded from the KerfDesk download page whose name matches the pattern for your
          computer. If anything doesn’t match, don’t open it.
        </p>`,
      })}
      <div class="prose">
        <h3>Windows</h3>
        <ol>
          <li>Run the setup file you downloaded.</li>
          <li>
            Only continue if it came from the KerfDesk download page and its name contains
            <code>-preview.</code> followed by a number.
          </li>
          <li>
            If SmartScreen says <strong>Windows protected your PC</strong>, choose
            <strong>More info</strong>.
          </li>
          <li>
            Check that the publisher is shown as unknown, then choose <strong>Run anyway</strong>.
          </li>
        </ol>
        <p>
          The signed Windows edition is different: its installer is code-signed. If Windows reports
          an unknown publisher for it, don’t run it. Download it again from the download page.
        </p>
        <h3>macOS</h3>
        <ol>
          <li>Open the disk image and drag <strong>KerfDesk.app</strong> to Applications.</li>
          <li>
            Control-click KerfDesk.app in Applications, choose <strong>Open</strong>, then choose
            <strong>Open</strong> again.
          </li>
          <li>
            If macOS still blocks it, open
            <strong>System Settings &gt; Privacy &amp; Security</strong> and choose
            <strong>Open Anyway</strong>.
          </li>
        </ol>
        <p>KerfDesk never turns off or quietly works around macOS Gatekeeper.</p>
        <p>
          After you install a newer Preview, your Mac may ask again for camera and local-network
          permission. Unsigned builds don’t carry a lasting signed identity for those permissions.
        </p>
      </div>`,
  });
}

function updatesSection(site) {
  return section({
    id: 'updates',
    narrow: true,
    eyebrow: 'Updates',
    title: 'How updates work',
    content: html`${featureGrid(updateItems(site))}
    ${callout({
      title: 'What the desktop update check sends',
      body: html`<p>
        To find out whether a newer Preview exists, the desktop Preview makes one small request to
        ${site.downloadHost} each time it opens. It sends no project, design, machine or job
        details, and no device ID. ${site.downloadHost} still sees normal connection details, such
        as your IP address and the time. If you’re offline or the check fails, nothing happens.
        Automated tests cover this check, but it hasn’t yet been tried on installed copies on real
        computers.
      </p>`,
    })}`,
  });
}

export const page = {
  path: '/download/',
  nav: null,
  title: 'Download',
  description:
    'Use KerfDesk in your browser, or get the desktop app for Windows 10/11 or macOS 13+ from the KerfDesk download page. KerfDesk Free needs no account.',
  render: (ctx) => {
    const { site, commerce } = ctx;
    return html`${pageHero({
      eyebrow: 'Download',
      title: 'Get KerfDesk',
      lead: 'Use KerfDesk in your browser, or install the desktop app on Windows or macOS. Both come in the same Free and Pro editions, and neither needs an account.',
      extra: actions(
        button(site.appUrl, 'Open KerfDesk in your browser', { iconName: 'arrow-right' }),
        button(site.downloadPageUrl, 'Desktop downloads', {
          variant: 'secondary',
          iconName: 'download',
        }),
      ),
    })}
    ${chooseSection(site)} ${sameAppSection(ctx)} ${filesSection()} ${installSection()}
    ${updatesSection(site)}
    ${section({
      id: 'questions',
      tone: 'alt',
      narrow: true,
      eyebrow: 'Questions',
      title: 'Download questions',
      content: faqList(downloadFaq(site, commerce)),
    })}
    ${section({
      narrow: true,
      content: callout({
        tone: 'safety',
        title: 'Before you run a job',
        body: html`<p>
          Check every job before you cut real material, and stay with the machine. The Abort button
          in KerfDesk is a software stop, not an emergency stop. Keep your machine’s physical E-stop
          or power switch within reach. <a href="/safety/">Read the safety notes</a>.
        </p>`,
      }),
    })}
    ${ctaBand({
      title: 'Ready to start?',
      body: 'Open KerfDesk in Chrome, Edge, Brave or Arc. KerfDesk Free needs no account.',
      buttons: [
        button(site.appUrl, 'Open KerfDesk'),
        button('/docs/', 'Get started', { variant: 'ghost-dark' }),
      ],
    })}`;
  },
};
