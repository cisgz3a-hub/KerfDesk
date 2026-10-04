## ADR-561 Amendment 3 - Install and close KerfDesk

Date: 2026-10-04

Status: Accepted by the maintainer's request to improve the update close flow.

### Decision

After an unsigned Windows update has downloaded and passed the existing verification, offer **Install and close KerfDesk**. This explicit action arms the existing manual installer and requests an approved application close. **Install when I close KerfDesk** remains available. An update notice, download, startup check or background poll never requests closing.

The update close retains the ordinary Save, Don't Save and Cancel decision and rechecks document identity before unload. It declines an already owned close and stays open during active jobs, Fire, controller or motion ownership, Frame preparation, Job Review, unsettled controller writes or acknowledgements, and observed external motion or spindle-on state. It uses the canonical transport ledger and retained accessory observations. Update consent never sends Abort, turns off Fire, authorises force-close recovery or waits to close automatically after machine work finishes. A cancelled or unavailable close requires another explicit install action.

Only completion of the trusted close grants installer authority. The existing quit handoff re-verifies publisher metadata, update eligibility and cached installer bytes and schedules the interactive installer after process exit with no force or silent arguments. Windows session end and unapproved, crashed or forced closure grant no installer authority. Renderer routes take a fixed empty request and never accept an executable path or download URL.

This amends ADR-561 decision 4 only for the explicit **Install and close KerfDesk** action. It changes neither the signed updater nor the 20-PR release cadence. Frame, Start, output, exports and running jobs gain no update or entitlement gate.

### Evidence boundary

Source checks and lifecycle simulations establish the action, cancellation and ownership contract. They do not qualify a newly packaged Windows installer, customer upgrade, physical machine or live publication. Existing installations gain this UI only after installing a release containing it.

References: [Electron application lifecycle and relaunch](https://www.electronjs.org/docs/latest/api/app) and [the pinned electron-builder v26 updater](https://www.electron.build/v26/docs/features/auto-update/).
