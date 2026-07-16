# Security Policy

KerfDesk controls lasers and CNC machines. Please treat vulnerabilities that can change output,
bypass a safety gate, expose local files or devices, or execute untrusted code as safety-sensitive.

## Supported versions

Security fixes are made on the latest release and the current `main` branch. Older builds are not
maintained separately; upgrade to the newest fixed release when one is published.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/cisgz3a-hub/KerfDesk/security/advisories/new>

Do not open a public issue with exploit details, machine identifiers, private project files, camera
credentials, or access tokens. If private reporting is unavailable, open a minimal public issue that
asks the maintainers to establish a private channel without describing the vulnerability.

Include the affected version or commit, platform, controller or device family when relevant, steps
to reproduce without moving real hardware where possible, impact, and any proposed mitigation.

## Coordinated disclosure

The maintainers will confirm receipt, reproduce and classify the report, agree on a disclosure plan,
and credit the reporter unless anonymity is requested. Please allow time for a tested fix and release
before publishing details. Reports involving machine motion or laser output require simulator tests
first and representative hardware validation before the fix is considered complete.

## Security boundaries

- Project, SVG, DXF, image, font, material-library, and migration files are untrusted input.
- The web app receives only browser-granted serial, camera, and file access.
- The Electron renderer is sandboxed, isolated from Node.js, navigation-locked, and constrained by
  a Content Security Policy and explicit permission handlers.
- Automatic desktop updates run only in signed packaged builds and require publisher-signature
  verification. Unsigned/manual builds remain updater-disabled.

Never test a suspected machine-control vulnerability with an energized spindle or laser unless the
machine is physically supervised, the work area is clear, and an immediate independent stop is
available. Tests that sever the transport (USB unplug, controller power loss) must run with laser
output physically disabled: after the link is gone the application has no channel to command the
beam off, and the controller can hold the last power level until buffered motion drains (ADR-212).
