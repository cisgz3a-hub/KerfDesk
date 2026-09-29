// Card and table copy for the About page. Sources: README.md (status table,
// naming note), PROJECT.md (product goal, non-negotiables 4, 5 and 8, stack,
// ADR-322 qualification note), SECURITY.md, public/support.html (the contact
// route and what a report should include), eslint.config.mjs, package.json
// release:check and .github/workflows/audit.yml (the vulnerability audit is
// nightly, not a PR gate), and src/core/controllers/grbl/frame-lines.ts (Frame
// jogs the job's bounding rectangle, so copy says "rectangle", not "outline").
// Licensing follows the owner's settled Free and Pro offer (ADR-524 Amendment
// 1), with no open-source selling points or repository links.

export const PRINCIPLES = [
  {
    icon: 'scan',
    title: 'Frame-first starts',
    body: 'Before a normal start, the machine traces a rectangle around the exact job with the laser or spindle off. That finished trace unlocks Start. Job Review findings are warnings for you to weigh.',
    href: '#frame-first',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'tags',
    title: 'Honest status labels',
    body: 'When something could read as “works on your machine”, we label how it was actually checked. The app labels its built-in machine profiles too.',
    href: '#labels',
  },
  {
    icon: 'wifi-off',
    title: 'Offline and private',
    body: 'No account, no analytics, no error reporting and no cloud sync. Your projects, machine details and jobs stay on your computer, and the installed web app keeps working offline.',
    href: '/privacy/',
  },
  {
    icon: 'file-check',
    title: 'Predictable output',
    body: 'The same design and settings give byte-identical G-code, and automated tests check it. If a job can’t be built, KerfDesk writes no file and sends nothing to the machine.',
    href: '#how-it-is-made',
  },
];

// [status key, meaning] — keys are lib/components.mjs STATUS entries.
export const LABELS = [
  [
    'hardware-verified',
    'Used in informal runs on a real machine. That is not a repeatable test, and it says nothing about the quality of the finished work.',
  ],
  [
    'simulator-only',
    'Tested against scripted firmware simulators over a fake serial port. A simulator can’t show real timing, electrical behavior or firmware quirks.',
  ],
  ['shipped-code-and-tests', 'Built and covered by automated tests, but not yet run on a machine.'],
  ['in-progress', 'Being built now. Parts are still missing.'],
  ['planned', 'On the plan, not built yet.'],
];

export const MADE = [
  {
    icon: 'layers',
    title: 'One codebase',
    body: 'The web app and the desktop Previews are built from the same strict TypeScript code. Only a thin layer for files, the serial port and drag-and-drop differs, plus a few desktop extras such as the network-camera helper.',
  },
  {
    icon: 'boxes',
    title: 'Strict module boundaries',
    body: 'Core logic, file I/O, platform and interface code live in separate modules, and lint rules control which may import which. Lint also keeps browser APIs, the clock and randomness out of the core.',
  },
  {
    icon: 'flask-conical',
    title: 'Automated tests',
    body: 'Snapshot tests pin the exact G-code for known jobs. Property tests check rules such as the laser staying off on every travel move. Every pull request must pass type checks, lint, license checks and the full test suite, and a nightly job audits dependencies for known vulnerabilities.',
  },
  {
    icon: 'notebook-pen',
    title: 'Written-down decisions',
    body: 'Design decisions and the reasons for them are recorded as numbered entries in the repository. An architectural change needs a new entry.',
  },
];

export function reportLinks(site) {
  return [
    {
      icon: 'bug',
      title: 'Report a problem',
      body: 'The support page lists what to include: your KerfDesk version, web or desktop, your machine and controller, and what happened. If a bug caused unsafe machine motion, describe it. Don’t re-run it.',
      href: site.reportUrl,
    },
    {
      icon: 'shield-alert',
      title: 'Report a security issue',
      body: `Email it to ${site.supportEmail} with “Security” in the subject, and don’t post the details anywhere public. Include the version, platform, controller family and steps to reproduce, without moving real hardware where you can.`,
      href: `mailto:${site.supportEmail}`,
    },
  ];
}
