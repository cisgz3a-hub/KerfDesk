# Machines and controllers

Last checked: 29 September 2026.

KerfDesk runs laser and CNC jobs on your machine over a USB cable. It is built for GRBL-family controllers (GRBL 1.1, grblHAL and FluidNC), and it also has drivers for Marlin and Smoothieware lasers and an experimental file export for Ruida controllers.

> **No machine has been qualified yet.** KerfDesk has been used for informal jobs on a Creality Falcon A1 Pro and a Neotronics 4040-class laser. Other controllers have been tested only against simulators. Treat every new machine, controller, feature and version as untested: start with an air run and a small test piece, and stay with your machine while it runs. Section 2 of the [Terms of Service](https://kerfdesk.com/terms/) explains how far KerfDesk has been tested and what you must do to run your machine safely.

## Controllers

| Controller | Connection | How far it has been tested |
| --- | --- | --- |
| grblHAL | USB cable | Used for informal jobs on a Creality Falcon A1 Pro, whose built-in profile uses the grblHAL driver. The machine's exact firmware build isn't independently confirmed. The driver is the GRBL one with grblHAL additions, tested against a GRBL simulator. |
| GRBL 1.1 | USB cable | Tested against a scripted GRBL simulator. No stock GRBL 1.1 controller board has had a recorded hardware test yet. |
| FluidNC | USB cable only, not Wi-Fi | Runs on the GRBL driver, tested against a GRBL simulator. Its settings live in FluidNC's own config file, so KerfDesk doesn't change them. |
| Marlin | USB cable | Tested against a scripted Marlin simulator. Laser jobs only, for a LASER_FEATURE build with inline power or a laser wired to the fan output. Your firmware settings need to match your KerfDesk profile. |
| Smoothieware | USB cable | Tested against a scripted Smoothieware simulator. Laser jobs only, using Smoothieware's own laser module settings. |
| Ruida (.rd export) | No live connection: export an .rd file and run it from the machine's panel or a USB stick | Experimental and vector-only. Checked by decoding the file back inside KerfDesk, not on hardware. No real Ruida controller has accepted one yet. |

KerfDesk connects to machines over USB only, not over Wi-Fi or a network. Trocen, TopWisdom and galvo controllers aren't supported.

## What you need to connect

- **A USB cable** that carries data, not a charge-only one.
- **A Chromium-based browser:** Chrome, Edge, Brave or Arc on Windows, macOS or Linux. They have Web Serial, the browser feature KerfDesk uses to reach your machine. In Brave, you may need to turn Web Serial on first.
- **Or the desktop Preview,** which has the same browser engine built in. Previews are early builds for Windows 10/11 and macOS 13 or newer; installing them and their serial-port access haven't been checked on real computers yet.
- **The USB driver, on Windows.** A missing driver is the most common reason a machine won't connect. Many diode lasers and 3018-style CNCs use a CH340 chip, and Windows usually needs its driver installed by hand.

## Laser profiles

- Named starter profiles for the Creality Falcon A1 Pro, xTool D1 Pro (5, 10, 20 and 40 W heads), Sculpfun S30, Ortur Laser Master 3 (three heads) and the Neotronics 4040 laser/CNC machine.
- No named profile yet for Atomstack, NEJE or OpenBuilds: start from the generic GRBL template.
- Confirm your work area, firmware, homing and power scale. No profile, the Falcon one included, has been qualified on the machine it describes.
- Each profile shows how well it has been checked, with labels like Public-spec starter, Simulator tested or Experimental.

## CNC router presets

- Size presets for the Genmitsu 3018-PRO and 4040-PRO, Shapeoko 3 and 3 XXL, X-Carve 1000 mm (November 2021), Sienci LongMill MK2 30×30, Neotronics 4040 Max, and Onefinity Woodworker and Journeyman.
- A preset sets only the work area and a spindle-speed limit. It doesn't pick your controller, and it can't control a router you switch on by hand.
- On a LongMill, choose GRBL 1.1h for a LongBoard or grblHAL for a SuperLongBoard.
- Onefinity's own controllers (Buildbotics, MASSO and Redline) aren't supported, so those presets are for size only.

## Not yet run on a real machine

- **Image engraving.** Photo and bitmap engraving is built and covered by tests, but hasn't had a recorded hardware test. Try a small test piece first.
- **CNC carving.** The CNC tools, including V-carve, 3D relief, adaptive clearing and touch-plate probing, have been tested in software only and haven't run on a real router. Air-cut before you cut material.
- **Rotary.** Rotary output has never run on a physical rotary, and Frame checks only the motion outline, not scale, direction or seam.
- **Box fit.** Generated finger-joint boxes haven't been cut and assembled on a machine yet. Box Fit Test makes test strips so you can check joint clearance on your own material first.

Read the [safety notes](https://kerfdesk.com/safety/) before you run a job. KerfDesk's Abort button is a software stop, not an emergency stop.
