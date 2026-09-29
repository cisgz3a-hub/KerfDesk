// Content for the License page. Every line traces to LICENSE, public/eula.txt,
// THIRD_PARTY_NOTICES.md or the owner's settled Free and Pro offer of
// 2026-09-29 (commerce.config.mjs, ADR-524 Amendment 1). Purchase isn't open:
// the terms of sale are published before sales open, so no refund or other
// sale term is written here. This is a plain-language summary; the license
// texts themselves decide.

import { formatPrice } from '../lib/commerce.mjs';
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

// The settled offer (commerce.config.mjs). The pricing page has the full terms.
export function proLicenseFacts(commerce) {
  const [plan] = commerce.plans;
  return [
    {
      icon: 'gift',
      title: 'Free has no time limit',
      body: 'KerfDesk Free needs no account and doesn’t expire, in the browser or on the desktop.',
    },
    plan && {
      icon: 'receipt',
      title: `${plan.name} is paid once`,
      body: `${formatPrice(plan.price, commerce.currency)}, one time, with one year of updates. Every version released during that year keeps working forever.`,
    },
    {
      icon: 'file-text',
      title: 'Terms before any sale',
      body: 'Purchase isn’t open yet. The terms of sale will be published before sales open, so you can read them first.',
    },
  ].filter(Boolean);
}

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

export function faqItems(site, commerce) {
  const [plan] = commerce.plans;
  return [
    {
      id: 'faq-buy',
      question: 'Do I need to buy a license to use KerfDesk?',
      answer:
        'No. KerfDesk Free has no time limit and needs no account. A Pro license adds the Pro tools, and purchase opens soon.',
    },
    {
      id: 'faq-business',
      question: 'Can I use KerfDesk in my business?',
      answer: html`<p>
        The versions released so far can be used for personal and commercial work under the terms in
        <a href="#current-license">Current license</a>. You remain responsible for running your
        machine safely. The terms for Pro will be published before sales open.
      </p>`,
    },
    plan && {
      id: 'faq-pro-cost',
      question: `What does a ${plan.name} license cost?`,
      answer: html`<p>
        ${formatPrice(plan.price, commerce.currency)}, paid once, with one year of updates. After
        that year, ${formatPrice(plan.updateYearPrice, commerce.currency)} adds another year of
        updates if you want it. It never renews automatically. Purchase opens soon. See
        <a href="/pricing/">pricing</a>.
      </p>`,
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
        No. It’s a plain-language summary. The texts themselves are what count: the License &amp;
        Safety Notice that ships with the app, with the full license text at its end, and the
        <a href="${site.noticesUrl}">third-party notices</a>.
      </p>`,
    },
  ].filter(Boolean);
}
