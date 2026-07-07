# Can't connect to your machine?

KerfDesk talks to your laser or CNC controller over a USB serial connection.
If the **Connect** button doesn't find your machine, or it connects but the
machine doesn't respond, work through the steps below in order — the first two
solve the large majority of cases.

---

## Before you start: use a supported browser

KerfDesk connects to machines using the browser's **Web Serial** feature, which
only exists in **Chromium-based browsers**:

- ✅ **Google Chrome**, **Microsoft Edge**, **Brave**, **Arc**
- ✅ The **KerfDesk desktop app** (it has the right browser engine built in)
- ❌ **Firefox** and **Safari** — these cannot connect to a machine at all

If you see **"WebSerial is not supported in this browser"**, switch to Chrome or
Edge, or install the desktop app.

---

## Step 1 — Check the physical connection

1. The machine is **powered on** (its own power switch, not just USB).
2. The **USB cable** runs from the controller to your computer.
3. The cable is a **data cable**, not a charge-only cable. Many USB cables carry
   power but no data — if in doubt, try a different cable.
4. If you use a USB hub, try plugging **directly into the computer** instead.

---

## Step 2 — Install the USB-to-serial driver (the most common fix on Windows)

Your controller board uses a small USB chip to appear as a serial (COM) port on
your computer. **Windows can talk to your machine only if the driver for that
chip is installed.** Some chips install automatically; the most common one on
hobby CNC and laser boards does **not** and must be installed by hand.

| Chip on your board | Found on | Do you need to install a driver? |
| --- | --- | --- |
| **CH340 / CH341** | Many diode lasers, 3018-style CNCs, cheap GRBL boards | **Usually yes** — Windows does not ship this driver. Install it from the WCH website (search "CH340 driver"). |
| **CP210x** (Silicon Labs) | Some engravers and controllers | Usually auto-installs via Windows Update; install the Silicon Labs "CP210x VCP" driver manually if it doesn't. |
| **FTDI** | Older / higher-end boards | Auto-installs on modern Windows. |
| **Genuine Arduino** (Uno/Nano) | DIY GRBL builds | Auto-installs on Windows 10 and 11. |

**How to tell which chip you have and whether the driver is working:**

1. Plug the machine in and power it on.
2. Open **Device Manager** (press `Win`, type "Device Manager").
3. Look under **Ports (COM & LPT)**:
   - A named entry like **"USB-SERIAL CH340 (COM5)"** or **"Silicon Labs CP210x
     (COM4)"** means the driver is installed and working. Note the COM number.
   - An entry with a **yellow warning triangle**, or an unknown device under
     **"Other devices"**, means the driver is **missing** — install the matching
     driver from the table above, then unplug and replug the machine.

> **macOS / Linux:** modern versions include CH340, CP210x, and FTDI drivers, so
> a manual install is rarely needed. On older macOS you may still need the
> vendor's CH340 driver.

---

## Step 3 — Pick the right port in KerfDesk

1. Click **Connect** (or run **Set up device** for the guided wizard).
2. In the port picker, choose the entry that matches the COM port you saw in
   Device Manager (for example, the CH340 port).
3. If several ports are listed and you're unsure which is the machine, unplug the
   machine, see which entry disappears, plug it back in — that's your port.

---

## Step 4 — It connects but the machine doesn't respond

If KerfDesk connects but position never updates or commands do nothing:

- **The machine is in an alarm state.** Many controllers start locked after
  power-on. Open the **GRBL console** and send **`$$`** to read settings; if the
  machine reports **Alarm**, home it (**`$H`**) if it has homing switches, or
  send **`$X`** to unlock — *only after confirming the head is in a safe spot.*
- **Another program is holding the port.** Only one application can use a serial
  port at a time. Close **LightBurn**, the **Arduino IDE**, or any other machine
  software, then reconnect.
- **Wrong baud rate.** Most GRBL machines use **115200**. If yours uses a
  different rate, set it in the device profile before connecting.

---

## Camera not working?

- **USB webcams** work directly — no extra software needed.
- **RTSP / IP cameras** require **`ffmpeg`** to be installed on your computer.
  KerfDesk will tell you if `ffmpeg` isn't found; install it from
  [ffmpeg.org](https://ffmpeg.org) and restart the app.

---

## Still stuck? Send us a diagnostic

KerfDesk can export a diagnostic file that captures your machine profile, the
controller's reported settings, and the recent serial log:

- **Read / Backup Controller Settings → Export machine diagnostic**

Attach that file to your support request so we can see exactly what your
controller reported.
