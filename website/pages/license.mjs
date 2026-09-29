// License. Plain facts only: KerfDesk comes in a Free and a Pro edition (the
// owner's settled offer, commerce.config.mjs, ADR-524 Amendment 1); the license
// of the versions released so far is named in one sentence
// (currentLicenseSection) and nowhere else on the site, with no link to the
// private source repository; bundled parts keep their own licenses. No sale, no
// sale terms (they are published before sales open) and no selling points about
// source access. The app's License & Safety Notice is public/eula.txt.

import {
  actions,
  button,
  callout,
  ctaBand,
  faqList,
  featureGrid,
  pageHero,
  section,
  table,
} from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import { NOTICE_PARTS, THIRD_PARTY_ROWS, faqItems, proLicenseFacts } from './license-data.mjs';

function todaySection() {
  return section({
    id: 'today',
    eyebrow: 'Using KerfDesk',
    title: 'The notice that comes with the app',
    lead: 'KerfDesk Free runs in the browser and on the desktop, and Pro comes with the Windows desktop app. The app comes with a short License & Safety Notice about machine safety and liability. The Windows installer shows it during setup, and Help > About KerfDesk in the app points to it.',
    content: html`${table({
      caption: 'What the five parts of the notice say',
      head: ['Part', 'In plain words'],
      rows: NOTICE_PARTS,
    })}
    ${callout({
      tone: 'safety',
      title: 'Abort is not an emergency stop',
      body: html`<p>
        The Abort button in KerfDesk is a software stop, not a safety-rated emergency stop. After a
        USB disconnect, a crash or a full controller buffer, the machine may keep moving after you
        click it. In an emergency, use your machine’s physical E-stop or cut the power. For the full
        summary, open Help &gt; Safety &amp; liability in the app or
        <a href="/safety/">read the safety notes</a>.
      </p>`,
    })}`,
  });
}

// The only place the website names the license of the released versions.
function currentLicenseSection() {
  return section({
    id: 'current-license',
    tone: 'alt',
    narrow: true,
    eyebrow: 'Current license',
    title: 'The terms for versions released so far',
    content: html`<div class="prose">
      <p>The versions of KerfDesk released so far are published under the MIT License.</p>
      <p>Versions already released keep the terms they were released under.</p>
      <p>
        KerfDesk is © 2026 Johann Stolk. The full license text is also printed at the end of the
        License &amp; Safety Notice in the app.
      </p>
    </div>`,
  });
}

function proLicenseSection(commerce) {
  return section({
    id: 'pro-license',
    eyebrow: 'Free and Pro',
    title: 'The Free edition and the Pro license',
    lead: 'Free has no time limit. Pro adds the Pro tools with a one-time license. Purchase opens soon; nothing can be bought yet.',
    content: html`${featureGrid(proLicenseFacts(commerce))}
    ${actions(button('/pricing/', 'See pricing', { iconName: 'tag', variant: 'secondary' }))}`,
  });
}

function thirdPartySection(site) {
  return section({
    id: 'third-party',
    tone: 'alt',
    eyebrow: 'Third-party components',
    title: 'Parts made by others keep their own licenses',
    lead: 'KerfDesk includes libraries, fonts and pictures made by other people. Each one keeps its own license.',
    content: html`${table({
        caption: 'A selection of the parts inside KerfDesk and their licenses',
        head: ['Component', 'License'],
        rows: THIRD_PARTY_ROWS,
      })}
      <div class="prose">
        <h3>The complete list</h3>
        <p>
          The full list is generated from every production package KerfDesk depends on, plus the
          bundled fonts and pictures. It ships with the app as
          <code>third-party-notices.txt</code>, together with the license texts those components
          require. Help &gt; About KerfDesk points to it, and the desktop app carries it too.
        </p>
        <h3>About the fonts</h3>
        <p>
          Fonts under the SIL Open Font License may be shared, but not sold on their own. A changed
          version of a font may not reuse its Reserved Font Name. Three bundled fonts declare one:
          UnifrakturMaguntia, Parisienne and Cinzel Decorative, whose reserved name is Cinzel.
        </p>
      </div>
      ${actions(
        button(site.noticesUrl, 'Read the third-party notices', {
          iconName: 'files',
          variant: 'secondary',
        }),
      )}`,
  });
}

function creditsSection() {
  return section({
    id: 'credits',
    narrow: true,
    eyebrow: 'Credits',
    title: 'Credits and trademarks',
    content: html`<div class="prose">
      <h3>Icons on this website</h3>
      <p>
        The icons on this website come from Lucide, Copyright (c) 2026 Lucide Icons and
        Contributors, and are used under the ISC License. Some Lucide icons are derived from the
        Feather project, Copyright (c) 2013-present Cole Bemis, which is under the MIT License. Read
        the <a href="/lucide-license.txt">full icon license text</a>.
      </p>
      <h3>Names and trademarks</h3>
      <p>
        LightBurn, GRBL, grblHAL, FluidNC, Marlin, Smoothieware, Ruida, Creality and the other
        product, company, firmware and machine names on this site may be trademarks of their owners.
        They are used only to name the software, firmware, machines and file formats they refer to.
        That use doesn’t imply any affiliation or endorsement.
      </p>
      <p>
        KerfDesk can open some LightBurn project files and cut libraries. It only reads them and
        never writes LightBurn files.
      </p>
    </div>`,
  });
}

export const page = {
  path: '/license/',
  nav: null,
  title: 'License',
  description:
    'How KerfDesk is licensed: the Free and Pro editions, what its License & Safety Notice says, the terms for released versions and how bundled parts are licensed.',
  render: ({ site, commerce }) =>
    html`${pageHero({
      eyebrow: 'License',
      title: 'Licensing and notices',
      lead: 'KerfDesk comes in a Free edition with no time limit and a Pro edition with a one-time license. This page covers the terms that apply now, the notice that comes with the app and how parts made by others are licensed.',
      extra: actions(
        button('#pro-license', 'About Free and Pro', { iconName: 'tag' }),
        button(site.noticesUrl, 'Third-party notices', { variant: 'secondary' }),
      ),
    })}
    ${todaySection()} ${currentLicenseSection()} ${proLicenseSection(commerce)}
    ${thirdPartySection(site)} ${creditsSection()}
    ${section({
      id: 'questions',
      tone: 'alt',
      narrow: true,
      eyebrow: 'Questions',
      title: 'License questions',
      content: faqList(faqItems(site, commerce)),
    })}
    ${ctaBand({
      title: 'Start with KerfDesk Free',
      body: 'Open KerfDesk in your browser or download the desktop app. Free needs no account and has no time limit.',
      buttons: [
        button(site.appUrl, 'Open the app'),
        button('/download/', 'Download', { variant: 'ghost-dark' }),
      ],
    })}`,
};
