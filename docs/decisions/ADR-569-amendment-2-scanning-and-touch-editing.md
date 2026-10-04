## ADR-569 Amendment 2 - Phone QR scanning and touch artwork editing

Date: 2026-10-04

Status: Accepted for the maintainer's request to build the remaining phone scanner and interactive artwork controls.

### Decision

The phone control page offers an explicit camera scan action. Camera frames are decoded locally, with platform QR detection and a self-hosted, pinned JavaScript fallback. Only a clean canonical KerfDesk control URL with one computer ID and one code in its fragment is accepted. The scanner fills the pairing form; it neither navigates nor submits it, saves its code, changes scopes or approves access. Camera tracks stop on success, cancellation, hidden/navigation state, permission loss and replaced requests. The response permits its own camera only on the successful top-level control document; microphone access remains disabled. Viewing, editing and machine permissions still require separate PC approval, with the original single-use and five-minute code lifetime.

Add touch authoring to the shared remote preview rather than transmitting another complete project or running another desktop workspace. A bounded viewport supplied by the renderer describes every pixel of the actual preview, including padding. Touch coordinates use that viewport and the rendered image content rectangle. The PC's canonical bed gives an empty workspace a useful view. Artwork visibility and editability hints omit hidden or locked hit targets, while the existing desktop write admission remains authoritative.

Offer Pan, Select, Move, Resize, Brush, Rectangle and Ellipse. Draft gestures remain local until explicit Apply and can be cancelled. Each applied change uses the ordinary document actions, shared undo history, exact expected revision and original idempotent request identity. A changed document, preview viewport or permission cancels the obsolete draft; hidden views and navigation also discard it. Background refresh does not repaint a gesture or replay an edit. Drawing supports ordinary Laser primitives; CNC permits existing supported transforms. Older clients without the capability and exact viewport remain view-only for these direct tools. No gesture or QR scan grants machine or Pro authority.

### Evidence boundary

Source, local browser/workerd checks and installed customer behaviour remain separate. Physical-phone cameras, ChatGPT hosts and physical machines require their own qualification. The matching desktop and service builds are required. The twenty-PR desktop release rule is unchanged.
