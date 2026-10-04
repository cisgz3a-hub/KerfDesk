## ADR-569 Amendment 1 - Easier pairing and live workspace views

Date: 2026-10-04

Status: Accepted for the maintainer's requests to simplify computer binding, follow PC canvas edits on the phone and improve remote navigation.

### Decision

Show a locally generated QR code and copyable one-time pairing link in desktop Phone & MCP settings. The full computer identity and existing code remain unchanged. The canonical HTTPS control-page link carries only those two values in its fragment. The phone removes the fragment before using the values to prefill its form, keeps no saved code, and requires the usual request and explicit PC approval. Existing five-minute expiry, single use, code replacement, revocation and separate viewing/editing/machine permissions remain authoritative. Manual setup remains available for older clients. Native browser-open failures do not log an error containing a private link.

Separate the remote interface into Design, Machine and Settings. Keep the ordinary Frame, current-program Review and affirmative Start flow, independent Abort ingress, discrete Jog and existing PC control approval. Navigation and refreshing grant no new machine or Pro authority.

Use bounded, nonoverlapping read-only refresh while the view is visible. Follow workspace revisions and refresh an opted-in preview only when needed. Pause hidden views and refresh on return. Preserve focused and unsent edits; they cannot silently replace a newer PC revision. While an owned machine action is unsettled, pause design reads and continue bounded status and receipt reads even outside Machine, so design refresh resumes when the action finishes. Background reads never retry consequential requests, replace their identifiers, acknowledge a review or confirm Start. Access loss clears shared content. The remote preview remains an image rather than a second desktop drawing canvas.

### Evidence boundary

Source and simulated host/browser checks are separate from production Worker deployment, installed desktop upgrades, actual ChatGPT/phone clients and physical machines. The matching desktop and service are required. This amendment does not change the twenty-PR desktop release cadence.
