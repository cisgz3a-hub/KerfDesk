// Plain-text safety & liability notice, shown from the Help menu. Lasers and
// CNC routers can cause fire, permanent eye injury, toxic fumes, and serious
// cuts, so this is deliberately blunt. The medium is a text alert
// (jobAwareAlert) — NO Markdown. The long-form version is docs/safety.md,
// published at kerfdesk.com/safety/, and section 2 of the Terms of Service
// (docs/legal/kerfdesk-licence-agreement.md) is the binding text. Keep them in
// sync when the wording changes. Warranty and liability belong to the terms:
// this notice never waives liability for injury (ADR-247 Amendment 2).

export const SAFETY_NOTICE_TEXT = [
  'SAFETY & LIABILITY — please read',
  '',
  'KerfDesk sends commands to lasers and CNC routers — machines that can cause',
  'fire, permanent eye injury, toxic fumes, and serious cuts.',
  'KerfDesk is NOT A SAFETY DEVICE and cannot guarantee a safe result. ABORT',
  'and its other stop controls are software stops, NOT EMERGENCY STOPS.',
  '',
  'EVERY JOB',
  ' - Verify the output first (preview, simulation, or an air run) before cutting.',
  " - Know your machine's PHYSICAL emergency stop — a lost USB command or full",
  '   buffer means the machine can keep moving after you click ABORT.',
  ' - Never leave a running machine unattended. Keep a fire extinguisher nearby.',
  '',
  'LASER',
  " - Wear eye protection rated for your laser's wavelength, even with a cover.",
  ' - Ventilate / extract fumes — never run in a closed room.',
  " - NEVER cut PVC or vinyl (toxic chlorine gas). Don't cut unknown materials.",
  '',
  'CNC ROUTER',
  ' - Safety glasses, hearing protection, dust mask. No loose clothing, gloves,',
  '   jewelry, or loose hair near a spinning tool.',
  ' - Clamp the workpiece securely; a loose part can break the bit and be thrown.',
  ' - Use dust extraction and keep hands clear while the spindle runs.',
  '',
  'You are responsible for safe operation and for following your machine',
  "manufacturer's instructions and your local safety regulations.",
  '',
  'Full guide: https://kerfdesk.com/safety/',
  'Terms, including warranties and the limits on our liability:',
  'https://kerfdesk.com/terms/',
].join('\n');
