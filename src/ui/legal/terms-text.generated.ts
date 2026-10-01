// Generated from docs/legal/kerfdesk-licence-agreement.md by scripts/generate-site-pages.mjs.
// Do not edit: change the terms, then run pnpm generate:site-pages (ADR-564).

export type TermsText = string | { readonly strong: string } | { readonly link: string };

export type TermsBlock =
  | { readonly kind: 'paragraph'; readonly text: ReadonlyArray<TermsText> }
  | { readonly kind: 'list'; readonly items: ReadonlyArray<ReadonlyArray<TermsText>> };

/** The version the terms state at their top. */
export const TERMS_VERSION = '1.0';

/** The terms' publication date as they state it, or null while it is a blank. */
export const TERMS_LAST_UPDATED: string | null = null;

/** Section 2, the machine-safety section, which first use shows in full. */
export const TERMS_SAFETY_HEADING = '2. MACHINE SAFETY: PLEASE READ THIS CAREFULLY';

export const TERMS_SAFETY_SECTION: ReadonlyArray<TermsBlock> = [
  {
    kind: 'paragraph',
    text: [
      {
        strong:
          'KerfDesk prepares and sends instructions to lasers, CNC routers and similar machines. These machines can start fires and cause serious injury or death, including permanent eye damage, burns and cuts. They can also damage property. A laser beam, even a reflection, can blind in an instant. Cutting some materials gives off toxic or corrosive fumes. A CNC tool can break or throw material. A mistake in a design, a setting, the software, the connection or the machine can make a machine move or fire when you do not expect it.',
      },
    ],
  },
  {
    kind: 'paragraph',
    text: [
      { strong: '2.1 What you must do.' },
      ' You are responsible for operating your machine safely and for the safety of everyone near it. In particular:',
    ],
  },
  {
    kind: 'list',
    items: [
      ['Never leave a running machine unattended.'],
      [
        'Check every job before you cut real material: review the preview, run Frame, and do an air run when in doubt.',
      ],
      [
        'Set up and maintain your machine correctly, including its configuration, work holding, enclosure, interlocks, fire safety, ventilation, and fume and dust extraction.',
      ],
      [
        'Wear eye protection rated for your laser’s wavelength and power, and protect anyone nearby. With a CNC router, wear safety glasses, hearing protection and a dust mask, keep loose clothing, gloves, hair and jewellery away from the tool, keep your hands clear while the spindle runs, and clamp the work securely.',
      ],
      [
        'Know what you are cutting. Do not cut materials that give off toxic or corrosive fumes, such as PVC or vinyl.',
      ],
      ['Keep a suitable fire extinguisher, and your machine’s own emergency stop, within reach.'],
      [
        'Follow your machine maker’s instructions and the safety laws and rules that apply where you work.',
      ],
    ],
  },
  {
    kind: 'paragraph',
    text: [
      { strong: '2.2 KerfDesk’s stop controls are not emergency stops.' },
      ' Abort and the other stop controls in KerfDesk are software stops. They depend on your computer, the connection and the machine’s controller, and they may not stop the machine at once. Closing KerfDesk, or reloading the web app (clicking Update in the web app reloads it), stops a running job part-way. Finish or stop a job before you do either. If your computer restarts, shuts down, goes to sleep or loses its connection to the machine during a job, the job stops part-way, and the machine may keep moving, or the laser or spindle may stay on, until you stop it at the machine. Finish or stop a job before you let Windows restart.',
    ],
  },
  {
    kind: 'paragraph',
    text: [
      { strong: '2.3 KerfDesk’s aids are not guarantees.' },
      ' Material settings, previews, simulations, time estimates, preflight checks and suggestions are aids. They do not guarantee that a job is correct, safe or suited to your machine and material. KerfDesk is not a safety device. Do not rely on it to prevent harm.',
    ],
  },
  {
    kind: 'paragraph',
    text: [
      { strong: '2.4 How far KerfDesk has been tested.' },
      ' We have not tested KerfDesk with every machine, controller, material or file, and how far each controller and feature has been tested varies a lot. When we wrote these terms, no machine, machine profile or controller had been formally qualified. KerfDesk had been used only for informal jobs on real machines, and most controllers had been tested only against simulators. Photo and image engraving, Ruida file export, rotary output and generated boxes had not had a recorded test on real hardware, and the CNC tools (including V-carve, 3D relief, adaptive clearing and touch-plate probing) had been tested only in software, not on a real router. The Machines page at ',
      { link: 'https://kerfdesk.com/machines/' },
      ' shows the current status. Treat every new machine, controller, feature and version as untested. Start with an air run and a small test piece.',
    ],
  },
  {
    kind: 'paragraph',
    text: [
      { strong: '2.5 Your confirmation.' },
      ' Before you first use KerfDesk, and before you buy Pro, we ask you to confirm separately that you have read this section, understand these risks and will operate your machine safely. Your confirmation does not reduce our own legal responsibility for KerfDesk (sections 15.1 and 16).',
    ],
  },
];
