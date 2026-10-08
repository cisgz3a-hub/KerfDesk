## ADR-571 - Retained design edits and explicit desktop adapters

Date: 2026-10-07. Status: accepted; local software verification passed, provider/native-device qualification outstanding.

### Context

The continuation of the Studio implementation requests live Boolean compounds, design-tree dragging, optional AI and hardware-dependent workflows for all machines. Portability requires shared design models plus explicit protocol adapters. A declared machine capability cannot supply an undocumented firmware, sensor or feed protocol.

### Decision

Project schema 14 stores optional live Boolean compounds and design-tree ranks. Compounds retain two to 1,000 non-recursive canonical vector operands, included in the existing scene allocation budget. Only the result owns scene/output identity. Reopening recomputes derived geometry from operands; Save serializes their canonical curves and checks semantic consistency. Source outlines and local transforms can be edited with review, Undo and explicit Expand. Weld preserves operation partitions. Moving between Weld and single-result Boolean operations requires Expand/recreate. Captured text and shape sources are path geometry rather than live fonts or parametric generators.

Design-tree dragging and accessible move controls change parent membership and presentation ranks. They do not change scene array order, manufacturing operations, CNC stages or artwork execution order. Locked descendants, cycles, ambiguous overlapping legacy membership and invalid destinations are refused with an explanation. Existing minimum group membership and save budgets remain in force.

The optional desktop AI assistant uses the operator's OpenAI API account and explicitly entered compatible model. Credentials live outside projects, encrypted with operating-system secure storage; no plaintext fallback is provided. Only Request draft makes an AI generation request. The fixed Responses API endpoint receives the prompt, dimensions and task, plus the visible bounded candidate recipe descriptions and optional selected photo for material requests. No tools, arbitrary URLs, canvas/project attachment or controller execution are provided. Both desktop and renderer validate and sanitize the bounded structured response. Material matches refer only to supplied saved recipes; they cannot introduce machine settings. Artwork Apply requires unchanged document ownership and the ordinary save allocation budget, and uses normal Undo. Cancellation invalidates delayed responses. No trial, account or entitlement check is added to Frame, Start, output or active jobs.

Requests set `store: false`, which does not establish Zero Data Retention. The privacy notice discloses request contents, encrypted key storage, ordinary provider connection information and the provider's data policy. No real credential or project is used during automated verification.

Documented controller-report commands expose firmware information without treating it as a qualification claim. FluidNC's documented Telnet channel has an explicit desktop TCP adapter with bounded local routes, Telnet negotiation, sequential writes and no discovery, replay or automatic reconnect. It uses the existing controller driver, ownership arbiter and Frame/Start workflow. Targets remain transient and are excluded from transport identity and diagnostics. Telnet is unencrypted and requires an appropriate trusted network. Other controller families retain their existing USB/export behavior unless an independently documented adapter exists.

GRBL-family surface measurement uses the existing owned probe transaction and confirmed `[PRB]` results. Preflight requires the configured probe/Z capability, confirmed report units, active coordinate system, known clearance and fresh work offsets. Setup or controller ownership changes cancel the measurement. Results are inspectable measured points and CSV evidence. This flow does not rewrite work offsets, set Z zero, compensate toolpaths or infer safe focus depth. Existing device-specific autofocus remains device-specific. Firmware-image installation, controller SD delivery, conveyor feed and automatic curved-surface compensation require their own documented adapters and physical recovery/workholding qualification; a generic implementation is not substituted for them.

### Evidence and limits

The implementation and current checks are recorded in the [implementation list](../implementation/xtool-workflows-20261007.md). Local source, simulators and loopback tests do not establish packaged installation, real API-account behavior, controller, material or physical-machine qualification. No provider state, firmware or hardware was changed.

Primary API/protocol sources:

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI API data handling](https://developers.openai.com/api/docs/guides/your-data)
- [Electron secure storage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [FluidNC Telnet server](https://raw.githubusercontent.com/bdring/FluidNC/main/FluidNC/src/WebUI/TelnetServer.cpp)
- [FluidNC Telnet client](https://raw.githubusercontent.com/bdring/FluidNC/main/FluidNC/src/WebUI/TelnetClient.cpp)
