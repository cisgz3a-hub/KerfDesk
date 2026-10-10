// Plain-text safety & liability notice, shown from the Help menu. Lasers and
// CNC routers can cause fire, permanent eye injury, toxic fumes, and serious
// cuts, so this is deliberately blunt. The medium is a text alert
// (jobAwareAlert) — NO Markdown. The long-form version lives in docs/safety.md
// and the published kerfdesk.com/safety/ page (website/pages/safety-data.mjs);
// the license + safety terms shown at install time live in public/eula.txt.
// Keep them in sync when the wording changes.

export const SAFETY_NOTICE_TEXT = [
  'SAFETY & LIABILITY — please read',
  '',
  'KerfDesk sends commands to lasers and CNC routers — machines that can cause',
  'fire, permanent eye injury, toxic fumes, and serious cuts. The software is',
  'provided "as is", with NO warranty, and you operate your machine ENTIRELY AT',
  'YOUR OWN RISK. It cannot guarantee a safe result.',
  '',
  "KerfDesk does not make or control your machine's safety features:",
  'interlocks, enclosures, thermal shutdown, fire detection and emergency stops',
  'are part of the machine.',
  '',
  'EVERY JOB',
  ' - Verify the output first (preview, simulation, or an air run) before cutting.',
  " - Know your machine's PHYSICAL emergency stop — a lost USB command or full",
  '   buffer means the machine can keep moving after you click ABORT.',
  ' - Never leave a running machine unattended. Watching on a camera, phone or',
  '   remote connection is NOT supervision — stay at the machine.',
  ' - No untrained users or unsupervised children. Switch off when not in use.',
  '',
  'IF A FIRE STARTS',
  ' - Stop the job and turn off air assist so you stop feeding the flame.',
  ' - Keep a fire extinguisher and a fire blanket where you can reach them',
  '   without leaning over the machine. If the fire grows, get out and call',
  '   emergency services.',
  '',
  'LASER',
  " - Wear eye protection rated for your laser's wavelength, even with a cover.",
  '   Some lasers emit light you cannot see.',
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
  'Full guide: https://kerfdesk.com/safety/ — Licence: see the License & Safety',
  'Notice (/eula.txt).',
].join('\n');
