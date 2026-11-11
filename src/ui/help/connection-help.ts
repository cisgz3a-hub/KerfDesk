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
  ' - In a browser, keep the KerfDesk tab in front while a job runs. In a',
  '   background tab or minimised window the computer can sleep and stop',
  '   the job; for long jobs, turn off sleep in your power settings.',
  ' - Use a short, shielded USB cable, away from spindle and laser power leads.',
  '',
  'K40 (M2/M3 NANO, MOSHIBOARD) OR GALVO (EZCAD2) LASER OVER USB?',
  ' - These boards are not serial ports: KerfDesk opens them over WebUSB, in',
  '   Chrome, Edge or the desktop app. This support is experimental: tested',
  '   against simulators only, not yet on a real machine.',
  ' - Windows: the board needs the WinUSB driver instead of its own. Run Zadig',
  '   (zadig.akeo.ie), choose the board (USB2.0-Print or USB-EPP for a K40,',
  '   USBLMC or BJJCZ for a galvo), pick WinUSB and Replace Driver. To go back',
  '   to LaserDRW or EZCad: Device Manager, uninstall the device, tick Delete',
  '   the driver, then unplug and replug the laser.',
  ' - Linux: give your user access with a udev rule, for example',
  '   SUBSYSTEM=="usb", ATTR{idVendor}=="1a86", ATTR{idProduct}=="5512",',
  '   MODE="0666" (galvo: 9588 and 9899), then replug the laser.',
  ' - macOS needs no driver.',
  ' - Close EZCad, LaserDRW, LightBurn and MeerK40t first: one program at a',
  '   time can hold the board.',
  '',
  'CAMERA: USB webcams work directly. RTSP/IP cameras need ffmpeg installed.',
].join('\n');

export const CONNECTION_HELP_TEXT = `${CONNECTION_HELP_STEPS}\n\nFull guide: ${CONNECTION_GUIDE_URL}`;
