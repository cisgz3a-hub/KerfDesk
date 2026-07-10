// Plain-text connection-troubleshooting help, shown from the Machine/Help menu
// (audit finding #41: in-product help was only an About alert). The medium is a
// text alert (jobAwareAlert), so this is deliberately plain — NO Markdown. The
// long-form version, including the full USB-chip driver table, lives in
// docs/connection-troubleshooting.md; keep the two in sync when either changes.

export const CONNECTION_HELP_TEXT = [
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
  ' - Another app (LightBurn, Arduino IDE) is holding the port — close it.',
  ' - Wrong baud rate: most GRBL machines use 115200.',
  '',
  'CAMERA: USB webcams work directly. RTSP/IP cameras need ffmpeg installed.',
  '',
  'Full guide: docs/connection-troubleshooting.md',
].join('\n');
