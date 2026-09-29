// Content for the License page. Every line traces to LICENSE, public/eula.txt,
// THIRD_PARTY_NOTICES.md or the maintainer's direction of 2026-09-23: KerfDesk
// is free to use today and paid licenses are planned, with nothing set yet.
// This is a plain-language summary; the license texts themselves decide.

import { html } from '../lib/html.mjs';

// public/eula.txt sections 1-5. Part 1 is summarized neutrally on purpose: the
// license of the released versions is named once, in the Current license section.
export const NOTICE_PARTS = [
  [
    '1. License',
    'Names the license the app is released under. The full license text is printed at the end of the notice.',
  ],
  [
    '2. Machine safety',
    'Lasers and CNC routers can cause fire, serious injury and property damage. You are responsible for running yours safely. Never leave a running machine unattended. Check every job with a preview, a simulation or an air run before you cut real material. Set up your machine and work holding correctly, make sure you can reach the emergency stop, and follow the maker’s instructions and your local safety rules. Previews, simulations and preflight checks are aids, not guarantees of safe output.',
  ],
  [
    '3. No warranty',
    'KerfDesk is provided “as is” and “as available”, with no warranty of any kind. No one guarantees that the output it generates is correct, safe or suited to your machine or material.',
  ],
  [
    '4. Limitation of liability',
    'As far as the law allows, the authors and copyright holders are not liable for any claim or damage that comes from the software or its use. That includes injury, fire, damage to machines or materials, and lost profits.',
  ],
  [
    '5. Third-party components',
    'KerfDesk bundles components made by other people, each under its own license. The notice points you to the third-party notices file for their required notices and license texts.',
  ],
];

// Maintainer direction 2026-09-23. Says only what is decided: free today,
// paid licenses planned, terms published before any sale. No price, scope,
// billing model or promise about what a paid license will include.
export const PAID_LICENSE_FACTS = [
  {
    icon: 'gift',
    title: 'Free to use today',
    body: 'There’s no account, no trial timer and no subscription.',
  },
  {
    icon: 'clock',
    title: 'Details come later',
    body: 'Prices, terms and timing for paid licenses haven’t been set yet.',
  },
  {
    icon: 'file-text',
    title: 'Terms before any sale',
    body: 'The terms will be published before anything is sold, so you can read them first.',
  },
];

// THIRD_PARTY_NOTICES.md:3-16, 20-32, 43-89. A selection, not the full list.
export const THIRD_PARTY_ROWS = [
  ['React, React DOM, Zustand, three.js, opentype.js', 'MIT'],
  ['Lucide icons', 'ISC'],
  ['Tabler Icons', 'MIT'],
  ['DOMPurify', 'MPL-2.0 or Apache-2.0'],
  ['clipper2-ts', 'Boost Software License 1.0'],
  ['imagetracerjs', 'Unlicense (public domain)'],
  ['23 bundled fonts, such as Poppins, Tinos and Relief SingleLine', 'SIL Open Font License 1.1'],
  ['The Roboto and Special Elite fonts', 'Apache License 2.0'],
  ['Eight OpenClipart pictures', 'CC0 (public domain dedication)'],
  ['Electron and Chromium, in the desktop app only', 'Their own licenses, shipped with the app'],
];

export function faqItems(site) {
  return [
    {
      id: 'faq-buy',
      question: 'Do I need to buy a license to use KerfDesk today?',
      answer:
        'No. KerfDesk is free to use today. There’s no account, no trial timer and no subscription.',
    },
    {
      id: 'faq-business',
      question: 'Can I use KerfDesk in my business?',
      answer:
        'Yes. KerfDesk is free to use today for personal and commercial work. You remain responsible for running your machine safely.',
    },
    {
      id: 'faq-later',
      question: 'Will KerfDesk cost money later?',
      answer:
        'Paid licenses are planned for the future. Prices, terms and timing aren’t set yet, and nothing is for sale today. The terms will be published before anything is sold.',
    },
    {
      id: 'faq-your-copy',
      question: 'What about the version I already have?',
      answer: html`<p>
        Versions already released keep the terms they were released under. See
        <a href="#current-license">Current license</a>.
      </p>`,
    },
    {
      id: 'faq-laserforge',
      question: 'Why does the name LaserForge show up in some places?',
      answer:
        'LaserForge 2.0 is the project’s earlier name. A few identifiers, such as the desktop app ID, still use it on purpose: changing them would break release identity and the place where your saved data lives.',
    },
    {
      id: 'faq-legal-advice',
      question: 'Is this page legal advice?',
      answer: html`<p>
        No. It’s a plain-language summary. The texts themselves are what count: the
        <a href="${site.licenseUrl}">license text</a>, the License &amp; Safety Notice that ships
        with the app, and the <a href="${site.noticesUrl}">third-party notices</a>.
      </p>`,
    },
  ];
}
