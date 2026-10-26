## ADR-103 Amendment 2 - Touch-off tests the probe circuit before it seeks (2026-10-26)

**Status:** Accepted. | **Date:** 2026-10-26

### Context

G2's touch-plate cycle (F-CNC20) starts with `G38.2 Z-<Max travel> F<seek feed>`, 25 mm at
150 mm/min by default (`src/core/controllers/grbl/probe.ts`). GRBL stops that move only on contact,
or with ALARM:5 at the end of the travel. Nothing read the probe input first. Status reports carry
it as `Pn:P` and `status-parser.ts` decoded it, but no screen or check used it. The only safeguard
was the hint "clip the probe lead to the bit".

So a lead that was never clipped on, or a broken one, drove the bit into the plate and the stock
until the travel ran out. That can mean lost steps, a damaged plate or a broken bit. The
2026-09-24 CNC audit recorded this as MC-2, and the 2026-09-29 pass ranked it first in "Fix these
next". No later round tracked it, and meta audit v1 confirmed it as M7-P2-1 on `adf300522`.

Peer senders prove the circuit before they seek. gSender keeps Start Probe disabled, labelled
"Waiting for probe circuit check...", until a status report shows the probe pin. Before that it
asks the operator to lift the plate to the tool and check the circuit
([RunProbe.tsx](https://github.com/Sienci-Labs/gsender/blob/426eaa1925c8ba4616882d297bb1ef2ae20652da/src/app/src/features/Probe/RunProbe.tsx#L160-L187)).
Carbide Motion users do the same check by touching the BitZero to the bit.

GRBL, grblHAL and FluidNC all report a closed probe input as `Pn:P`, and leave `Pn:` out while no
input is active.
- GRBL: [report.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L567-L573),
  under `REPORT_FIELD_PIN_STATE`, which is on by default.
- grblHAL: [report.c](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L1409-L1436),
  under `$10` bit 4 (pin state).
- FluidNC: [Report.cpp](https://github.com/bdring/FluidNC/blob/c82d217cad69fa937d57cee24fcf7ce9080fba05/FluidNC/src/Report.cpp#L467-L468).

GRBL itself refuses a `G38.2` while the input is already closed, with ALARM:4
([motion_control.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L273-L274)).

### Decision

1. **A touch-off needs one test touch.** The Z and XYZ corner cycles run only after a status
   report in the current controller session showed the probe input closed. The input must also be
   open in the latest report (`src/ui/state/probe-test-touch.ts`). The store enforces this in the
   probe preflight, after every other check, so a cycle that cannot run for another reason still
   says that reason. No motion is sent before it passes.
2. **What counts as a touch.** It is any report with `Pn:P`, except while a probe cycle runs, since
   the cycle's own contacts prove nothing about the lead. Touches during a tool-change hold count,
   because that is where a new bit is touched off. Touches in Alarm count too: after ALARM:5 the
   operator clips the lead on and tests it before `$X`. A streamed job voids a touch, because the lead
   comes off for the cut. So does a new controller session.
3. **Each cycle uses the touch up.** Starting a cycle clears it, so a retry after ALARM:5 (the lead
   was off) asks for a new touch.
4. **Refuse while closed.** If the input is closed when Run probe is pressed, the cycle is refused
   before GRBL would raise ALARM:4. The reason names a shorted lead and the probe-input invert
   (`$6` on GRBL and grblHAL).
5. **The panel shows the circuit.** The probe controls show a live line: "not tested", "closed"
   (take the plate away) or "tested". Run probe stays disabled until the circuit is tested, and its
   tooltip gives the reason.
6. **grblHAL with pin state off.** When a full `$$` shows `$10` without bit 4, no report can ever
   carry `Pn:`. The reason then names the `$10` to send (the same value with bit 4 set), as
   ADR-375 Amendment 2 does for WCO and Ov. KerfDesk never writes `$10` itself.
7. The surface (height-map) probe, ALARM handling and the probe cycle's G-code are unchanged.

### Consequences

- A forgotten or broken lead no longer drives the bit into the plate: no `G38.2` is sent until
  the circuit has closed and opened again.
- Each touch-off asks for one extra action: touch the plate to the bit, then take it away. An
  idle machine is polled about once a second (every 4th 250 ms tick), so a quick tap can fall
  between reports. The panel says to hold the plate on the bit until the line reads closed.
- A stock GRBL build compiled without `REPORT_FIELD_PIN_STATE` never reports the input, so it
  cannot touch off from KerfDesk. Zero Z here still works. Unlike gSender, KerfDesk has no setting
  to skip the test.
- Code and simulator evidence only. The GRBL simulator now models a probe input
  (`setProbeInput`), and `probe-test-touch.simulator.test.ts` drives the real store against it.
  Not hardware-tested.
