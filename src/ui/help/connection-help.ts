// Plain-text connection-troubleshooting help, shown from Help and from Machine
// Setup's connection strip (audit finding #41; UX audit U2-P3-6). It is shown
// pre-formatted in an in-app dialog, so it stays plain: NO Markdown. The
// long-form version, including the full USB-chip driver table, lives in
// docs/connection-troubleshooting.md, and the published one on the website's
// Get started page; keep them in sync when either changes. The app ships
// without docs/, so the help names the published page (2026-07-10 S12-F1).

/** The published troubleshooting section (website/pages/docs.mjs). */
export const CONNECTION_GUIDE_URL = 'https://kerfdesk.com/docs/#troubleshooting';

export const CONNECTION_HELP_TITLE = "Can't connect?";

/** Opens the connection help dialog from anywhere (Help menu, toolbar hint). */
export const CONNECTION_HELP_EVENT = 'kerfdesk:connection-help';

/** The steps, without the closing pointer to the published guide. */
export const CONNECTION_HELP_STEPS = [
  "Can't connect to your machine?",
  '',
  'Most connection problems are one of these. Try them in order:',
  '',
  '1. USE A SUPPORTED BROWSER',
  '   Connecting needs Chrome, Edge, Brave, or Arc — or the desktop app.',
  '   Firefox and Safari cannot connect to a machine.',
  '   On Brave, WebSerial may require enabling under Brave Shields/flags.',
  '',
  '2. INSTALL THE USB-TO-SERIAL DRIVER (most common fix on Windows)',
  '   Your controller shows up as a COM port only if its USB chip driver is',
  '   installed. The common CH340 chip (many diode lasers and 3018 CNCs) needs',
  '   a manual install on Windows — search "CH340 driver". CP210x, FTDI, and',
  '   genuine Arduino boards usually install themselves.',
  '   Check Windows Device Manager > Ports (COM & LPT): a yellow warning icon',
  '   means the driver is missing.',
  '',
  '3. CHECK THE CABLE AND POWER',
  '   Machine powered on, a DATA USB cable (not charge-only), plugged straight',
  '   into the computer rather than a hub.',
  '',
  '4. PICK THE RIGHT PORT',
  '   Click Connect and choose the port that matches Device Manager. Unsure',
  '   which? Unplug the machine and see which entry disappears.',
  '',
  "CONNECTS BUT DOESN'T RESPOND?",
  ' - In Alarm: send $X to unlock (only when the head is safe), or $H to home.',
  ' - Another program is holding the port: close any other laser or CNC',
  '   software, serial terminal, or the Arduino IDE, then reconnect.',
  ' - Wrong baud rate: most GRBL machines use 115200.',
  '',
  'DISCONNECTS DURING A JOB?',
  ' - Windows may switch the USB port off to save power. In Power Options,',
  '   Change advanced power settings, set USB selective suspend to Disabled.',
  ' - Set Active hours in Windows Update so it does not restart during long',
  '   jobs. The desktop app asks Windows to wait while a job runs.',
  ' - Use a short, shielded USB cable, away from spindle and laser power leads.',
  '',
  'CAMERA: USB webcams work directly. RTSP/IP cameras need ffmpeg installed.',
].join('\n');

export const CONNECTION_HELP_TEXT = `${CONNECTION_HELP_STEPS}\n\nFull guide: ${CONNECTION_GUIDE_URL}`;
