# Safety & responsible use

**Read this before you run any job.** KerfDesk prepares toolpaths and sends commands to **laser cutters and CNC routers — machines that can cause fire, permanent eye injury, toxic fumes, serious cuts, and flying debris.** You are responsible for operating your machine safely. KerfDesk is a tool that generates instructions; it cannot see your workshop, your material, or your machine, and it **cannot guarantee a safe result.**

## What KerfDesk can't do for you

- **KerfDesk is not a safety device.** Its Abort and other stop controls are software stops. They depend on your computer, the connection and the machine's controller, and they may not stop the machine at once.
- **A job can stop part-way.** Closing KerfDesk, or reloading the web app (clicking Update in the web app reloads it), stops a running job part-way. If your computer restarts, shuts down, goes to sleep or loses its connection to the machine during a job, the machine may keep moving, or the laser or spindle may stay on, until you stop it at the machine.
- **Its aids are not guarantees.** Material settings, previews, simulations, time estimates, preflight checks and suggestions do not guarantee that a job is correct, safe or suited to your machine and material.
- **No machine has been qualified yet.** Treat every new machine, controller, feature and version as untested. The [Machines page](https://kerfdesk.com/machines/) shows how far each has been tested.

You are responsible for operating your machine safely and for the safety of everyone near it, and for following your machine maker's instructions and the safety laws and rules that apply where you work. Section 2 of the [Terms of Service](https://kerfdesk.com/terms/) sets this out. Warranties, the limits on our liability and your legal rights where you live are in sections 14 to 16 of the terms. Those limits never apply to death or personal injury caused by our negligence or by a defect in KerfDesk.

## Before every job

- **Verify the output before you cut.** Use the preview, the simulation, or an
  "air" run (job run with the tool clear of the material) to confirm the path,
  depth, and travel are what you expect. Generated G-code can be geometrically
  wrong and still run.
- **Know where your machine's physical emergency stop is** and how to cut power.
  Software commands can be lost — a USB disconnect, a crash, or a firmware buffer
  already full means the machine may keep moving after you click Stop. **Only the
  physical E-stop / power switch is guaranteed to stop the machine.**
- **Never leave a running machine unattended.**
- **Keep a fire extinguisher within reach** (a CO₂ or dry-chemical extinguisher;
  water is not appropriate for electrical fires).

## Laser cutters and engravers

- **Protect your eyes.** Laser light — direct or reflected — can cause permanent
  eye damage in a fraction of a second. Wear **safety glasses rated for your
  laser's wavelength**, even if the machine has an enclosure, and never look at
  the beam or defeat safety interlocks.
- **Ventilate and extract fumes.** Cutting and engraving produce smoke and fumes
  that can be harmful. Use fume extraction or work in a well-ventilated area.
  **Never run a laser in a closed room.**
- **Never cut PVC, vinyl, or other chlorine-containing plastics.** They release
  **chlorine gas and hydrogen chloride** — toxic to you and corrosive to your
  machine. Also avoid fiberglass, ABS, polycarbonate, and any material whose
  composition you do not know. **If you are not sure what a material is, do not
  cut it.**
- **Fire is the biggest risk.** Keep the bed clear of scrap and debris, keep the
  machine clean, and stay with the machine the whole time it runs.

## CNC routers and mills

- **Wear PPE:** safety glasses, hearing protection, closed-toe shoes, and a dust
  mask appropriate to the material.
- **No loose clothing, gloves, jewelry, or loose hair** near a spinning tool —
  they can be caught and pull you in. Roll up sleeves and tie back hair.
- **Clamp the workpiece securely.** A part that shifts or comes loose can break
  the bit and be thrown at high speed.
- **Extract dust.** Wood and composite dust is a respiratory hazard, and some
  dust is combustible. Use dust collection and ventilation.
- **Keep hands clear of the tool** while the spindle is running, and let the
  spindle stop before reaching in.

## Materials and local rules

You are responsible for knowing that a material is safe to cut or engrave, for the fumes and dust it produces, and for complying with local fire, electrical, ventilation, and safety regulations. When in doubt, consult the material's safety data sheet (SDS) and your machine manufacturer's guidance.

---

The app summarizes this under **Help → Safety & liability**. It is published at https://kerfdesk.com/safety/.
