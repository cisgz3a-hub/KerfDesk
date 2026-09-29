// Copy for the Machines page. Every row is grounded in the repo at origin/main:
// README.md "Controllers", PROJECT.md Phase I (incl. the 2026-09-19
// qualification note and ADR-322), src/core/devices/profile-catalog.ts,
// src/core/cnc/cnc-machine-catalog.ts, docs/connection-troubleshooting.md and
// src/platform/web/camera-bridge.ts. PROJECT.md records that the former Falcon
// "hardware-verified" claim has no repeatable evidence, so 'hardware-verified'
// (label: "Used on a real machine") means informal use only, and the Falcon's
// firmware is described as GRBL-family, not as a confirmed grblHAL build.

// status keys come from STATUS in lib/components.mjs.
export const CONTROLLERS = [
  {
    family: 'grblHAL',
    connection: 'USB cable',
    tested:
      'KerfDesk has been used for informal jobs on a Creality Falcon A1 Pro, whose built-in profile uses the grblHAL driver. The machine’s exact firmware build isn’t independently confirmed. The driver is the GRBL one with grblHAL additions, tested against a GRBL simulator.',
    status: 'hardware-verified',
  },
  {
    family: 'GRBL 1.1',
    connection: 'USB cable',
    tested:
      'Tested against a scripted GRBL simulator. No stock GRBL 1.1 controller board has had a recorded hardware test yet.',
    status: 'simulator-only',
  },
  {
    family: 'FluidNC',
    connection: 'USB cable only, not Wi-Fi',
    tested:
      'Runs on the GRBL driver, tested against a GRBL simulator. Its settings live in FluidNC’s own config file, so KerfDesk doesn’t change them.',
    status: 'simulator-only',
  },
  {
    family: 'Marlin',
    connection: 'USB cable',
    tested:
      'Tested against a scripted Marlin simulator. Laser jobs only, for a LASER_FEATURE build with inline power or a laser wired to the fan output. Your firmware settings need to match your KerfDesk profile.',
    status: 'simulator-only',
  },
  {
    family: 'Smoothieware',
    connection: 'USB cable',
    tested:
      'Tested against a scripted Smoothieware simulator. Laser jobs only, using Smoothieware’s own laser module settings.',
    status: 'simulator-only',
  },
  {
    family: 'Ruida (.rd export)',
    connection:
      'No live connection. Export an .rd file and run it from the machine’s panel or a USB stick.',
    tested:
      'Experimental and vector-only. Checked by decoding the file back inside KerfDesk, not on hardware. No real Ruida controller has accepted one yet.',
    status: 'shipped-code-and-tests',
  },
];

export const CONNECT_NEEDS = [
  {
    icon: 'usb',
    title: 'A USB cable',
    body: 'KerfDesk talks to your controller over a USB serial connection. Use a cable that carries data, not a charge-only one. It doesn’t control machines over Wi-Fi or a network.',
  },
  {
    icon: 'globe',
    title: 'A Chromium-based browser',
    body: 'Chrome, Edge, Brave or Arc on Windows, macOS or Linux. They have Web Serial, the browser feature KerfDesk uses to reach your machine. In Brave, you may need to turn Web Serial on in Shields or flags first.',
  },
  {
    icon: 'monitor-down',
    title: 'Or the desktop Preview',
    body: 'It has the same browser engine built in, so you click Connect and pick your port the same way. Previews are unsigned early builds for Windows 10/11 and macOS 13 or newer. Installing and serial-port access haven’t been checked on real computers yet.',
    href: '/download/',
  },
  {
    icon: 'plug-zap',
    title: 'The USB driver, on Windows',
    body: 'A missing driver is the most common reason a machine won’t connect. Many diode lasers and 3018-style CNCs use a CH340 chip, and Windows usually needs its driver installed by hand.',
  },
];

export const LASER_POINTS = [
  'Named starter profiles for the Creality Falcon A1 Pro, xTool D1 Pro (5, 10, 20 and 40 W heads), Sculpfun S30, Ortur Laser Master 3 (three heads) and the Neotronics 4040 laser/CNC machine',
  'No named profile yet for Atomstack, NEJE or OpenBuilds: start from the generic GRBL template',
  'Confirm your work area, firmware, homing and power scale. No profile, the Falcon one included, has been qualified on the machine it describes.',
  'Each profile shows how well it has been checked, with labels like Public-spec starter, Simulator tested or Experimental',
];

export const ROUTER_POINTS = [
  'Size presets for the Genmitsu 3018-PRO and 4040-PRO, Shapeoko 3 and 3 XXL, X-Carve 1000 mm (November 2021), Sienci LongMill MK2 30×30, Neotronics 4040 Max, and Onefinity Woodworker and Journeyman',
  'A preset sets only the work area and a spindle-speed limit. It doesn’t pick your controller, and it can’t control a router you switch on by hand.',
  'On a LongMill, choose GRBL 1.1h for a LongBoard or grblHAL for a SuperLongBoard',
  'Onefinity’s own controllers (Buildbotics, MASSO and Redline) aren’t supported, so those presets are for size only',
];

export const NOT_YET_ON_A_MACHINE = [
  {
    icon: 'image',
    title: 'Image engraving',
    body: 'Photo and bitmap engraving is built and covered by tests, but hasn’t had a recorded hardware test. Try a small test piece first.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'drill',
    title: 'CNC carving',
    body: 'The CNC tools, touch-plate probing included, have been tested in software only and haven’t run on a real router. Air-cut before you cut material.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'rotate-3d',
    title: 'Rotary',
    body: 'Roller and chuck rotary settings for lasers live under Tools > Rotary Setup. Rotary output has never run on a physical rotary, and Frame checks only the motion outline, not scale, direction or seam.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'box',
    title: 'Box fit',
    body: 'Generated finger-joint boxes haven’t been cut and assembled on a machine yet. Box Fit Test makes test strips so you can check joint clearance on your own material first.',
    status: 'shipped-code-and-tests',
  },
];

export const CAMERAS = [
  {
    kind: 'USB webcam',
    where: 'Web app and desktop Preview',
    notes: 'No extra software needed.',
    status: 'shipped-code-and-tests',
  },
  {
    kind: 'Network camera (JPEG snapshots)',
    where: 'Desktop Preview only',
    notes:
      'The camera must be on your local network. A small camera helper that comes with the desktop app fetches the pictures.',
    status: 'shipped-code-and-tests',
  },
  {
    kind: 'Network camera (RTSP stream)',
    where: 'Desktop Preview only',
    notes: 'Also needs ffmpeg installed on your computer. RTSP support hasn’t been qualified yet.',
    status: 'shipped-code-and-tests',
  },
];

export const CHECKLIST = [
  {
    title: 'Find your firmware',
    body: 'Your controller should run GRBL 1.1, grblHAL or FluidNC, or Marlin or Smoothieware for a laser. When you connect, KerfDesk reads its startup message and warns you if it doesn’t match your profile.',
  },
  {
    title: 'Check for USB',
    body: 'KerfDesk needs a USB serial connection. A machine you can only reach over Wi-Fi or a network won’t connect. Ruida CO₂ machines get an experimental file export instead.',
  },
  {
    title: 'Use a browser that can connect',
    body: 'Chrome, Edge, Brave or Arc, or the desktop Preview. Firefox and Safari can’t connect to a machine.',
  },
  {
    title: 'Install the driver if needed',
    body: 'On Windows, open Device Manager and look under Ports (COM & LPT). A yellow warning icon means the USB driver is missing.',
  },
  {
    title: 'Pick a profile, then confirm it',
    body: 'Choose the closest profile or a generic template. Match the work area, homing, power scale and baud rate to your machine. Most GRBL machines use 115200 baud.',
  },
  {
    title: 'Try it without cutting',
    body: 'Preview the toolpath, then Frame the job: the head traces its outline with the laser or spindle off. Run your first job on scrap and stay with the machine.',
  },
];

export const REPORT_ITEMS = [
  'Your machine’s make and model, and the controller family and firmware version it reports',
  'The KerfDesk profile you chose, and anything you changed in it',
  'Web app or desktop Preview, plus your browser and operating system',
  'What you ran (a Frame, a line cut, a fill or an image) and what happened',
  'For a problem, the steps that led to it',
];

export const FAQ = [
  {
    id: 'faq-wifi',
    question: 'Can KerfDesk control my machine over Wi-Fi?',
    answer:
      'No. KerfDesk connects over a USB cable only, and that includes FluidNC boards. Networked control isn’t supported.',
  },
  {
    id: 'faq-unlisted',
    question: 'My machine isn’t listed. Can I still try it?',
    answer:
      'You can, if its controller runs one of the firmware families above and connects over USB. Start from the generic template for that family, confirm the work area, homing, power scale and baud rate, then Frame the job and run it on scrap first. Trocen, TopWisdom and galvo controllers aren’t supported.',
  },
  {
    id: 'faq-verified',
    question: 'Why isn’t any machine listed as qualified?',
    answer:
      'Jobs have run on two real machines, but those were informal runs, not recorded, repeatable tests. So each controller is labeled by what actually happened: informal use, simulator tests or automated tests.',
  },
  {
    id: 'faq-settings',
    question: 'Will KerfDesk change my controller’s settings?',
    answer:
      'Not unless you ask it to. On GRBL and grblHAL you can queue setting changes in Machine Setup, but only after KerfDesk reads your current settings, you confirm you’ve exported a backup and you confirm each change. Saving then writes only the changes you queued and reads each one back to check it. Cancel sends nothing. FluidNC, Marlin, Smoothieware and Ruida never receive these writes.',
  },
  {
    id: 'faq-no-machine',
    question: 'Can I use KerfDesk without connecting a machine?',
    answer:
      'Yes. You can design, preview and save projects without connecting anything. File > Save G-code writes a .gcode or .nc file you can run with another sender.',
  },
];
