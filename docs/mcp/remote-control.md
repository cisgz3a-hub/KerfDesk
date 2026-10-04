# Phone and MCP access

Remote access connects the desktop workspace to a phone control page and standard MCP clients. It starts turned off. The computer must be awake, online and running KerfDesk. The mobile website includes **Phone & MCP** setup alongside the licence and download options, without opening the desktop canvas.

## Connect a phone

1. In **KerfDesk on the computer**, open **Edit > Settings… > Phone & MCP** and enable **Allow approved remote connections**.
2. Wait for **Ready to pair** (older versions say **Connected to the remote service**). Create a pairing code. **Copy code** preserves its exact letter case.
3. Use **Copy phone link** to open the connection page on your phone with the computer ID already filled in. You can also visit **[kerfdesk.com](https://kerfdesk.com)** and choose **Phone & MCP > Connect to your PC**. Enter the matching computer ID if needed, then the latest code.
4. Approve the named connection on the computer. Viewing is the default. Select **Allow artwork and operation editing** and/or **Allow Jog, Frame, Start and Abort** only if you want those requested permissions, then choose **Approve selected access**. Both choices start off.
5. The phone page displays the current workspace and its available controls. It does not mount the desktop canvas.

Codes are usable once and expire after five minutes. Pairing is not a Pro licence or a computer activation. A phone connection can be revoked from the same Settings section.

Creating another code replaces the preceding code. The desktop waits for the matching new offer before displaying it; delayed polling cannot put an older offer back on screen. Approval requests initially focus the dialog surface, so an Enter or Space keypress from a field cannot activate an approval button.

The relay enforces the real expiry. Its messages retain the absolute expiry for existing desktop clients and supply bounded remaining lifetime for current clients. Current desktop clients use a monotonic clock for local presentation and decisions, independently of the PC's wall-clock setting. A missing or invalid remaining lifetime cannot enable pairing; it produces a service-update message. These changes do not extend the server's code or approval lifetime.

The setup page opens the controls as a full-page navigation to KerfDesk's existing remote service. Its first-party session cookie remains Secure, HttpOnly and SameSite Strict; control-page framing remains disabled. The mobile setup page itself has no scripts or session data. PWA navigation never substitutes the machining canvas for the phone setup page.

If the phone reports that pairing is unavailable and nothing appears on the PC, first check **Ready to pair**, the matching Computer ID and the newest exact-case code. A rejection does not by itself prove the code expired: a disconnected PC, replaced code or permission limit can also reject the request before any desktop prompt. Do not share codes or licence keys when requesting support.

## Connect ChatGPT or another MCP app

Add this Streamable HTTP MCP URL in a client that supports authenticated remote servers:

`https://kerfdesk-phone-control.cisgz3a.workers.dev/mcp`

In desktop Settings, expand **Connect ChatGPT or another MCP app** to copy the server URL and computer ID. Use the OAuth sign-in page to enter that computer ID and a new pairing code, then approve the requested permissions on the computer. The client receives access to that computer only. The authorization page and the desktop approval both show the requested access. If clipboard access is unavailable, the desktop displays the exact value for manual copying.

In ChatGPT's web settings, enable **Developer mode** under **Security and login**, then create a connection from **ChatGPT Plugins** using the MCP URL above and OAuth. Let ChatGPT discover the login addresses. Its setup defaults to `kerfdesk:read`. In **Advanced OAuth settings > Base scopes**, add `kerfdesk:edit` for artwork editing and `kerfdesk:control` for machine controls, then explicitly approve the requested choices on the PC. For machine control without artwork editing, use `kerfdesk:read kerfdesk:control`; for all three permissions, use `kerfdesk:read kerfdesk:edit kerfdesk:control`. `offline_access` is optional and requests reconnection with that approval for up to 30 days. The exact settings and availability depend on the account and workspace.

Revoked or expired computer approval returns an OAuth reauthorization challenge instead of a bare authorization failure. The new sign-in still requires an available, approved computer connection. Tokens without the required editing or machine-control scope receive a standard permission challenge; the client must request and obtain that permission before retrying. Remote tool metadata declares each permission requirement through the SDK's supported OpenAI compatibility field. This metadata grants no access, and the local stdio server does not advertise remote OAuth requirements.

ChatGPT's custom-server controls depend on the current plan, workspace and client. Private developer-mode setup and an approved public plugin are separate distribution paths. A working MCP endpoint does not establish availability in every ChatGPT phone app or approval for the public plugin directory. The separate phone control page works through an ordinary supported mobile browser.

## What connections can do

Viewing connections can read bounded artwork and operation summaries, machine limits, edition/update status, bundled fonts, material recipes and the current prepared job review. In **Settings > Phone & MCP** on the PC, separately enable **Share artwork previews and text with approved phones and MCP apps** to allow PNG previews and existing text reads. This preference starts off; pairing alone does not enable it. Approved MCP apps may send shared content to their AI provider.

Editing connections can also:

- select existing artwork;
- move, rotate or resize supported existing artwork;
- create basic text or rectangles in Laser workspaces;
- change an ordinary laser operation's power, speed, passes and enabled state;
- edit ordinary existing text, including its wording, bundled font, size, alignment and spacing;
- align, distribute, mirror, group, ungroup, duplicate or delete editable artwork;
- use the same Undo and Redo history as the PC.

New text uses a chosen bundled font, or the bundled regular font when no font is supplied. Its requested width is a maximum layout width; overflow shrinks uniformly. Line height and letter spacing are multipliers of font size. Existing path text and variable text can be reviewed on the PC; this phase does not edit them remotely. Layout alignment uses the last requested artwork as its reference, and distribution spaces group centres equally. CNC creation and CNC operation settings are not included. Existing desktop Pro rules still apply; duplicating independent Pro artwork requires the ordinary Pro admission and leaves no delayed remote edit.

The paired phone page opens directly to **Artwork**, **Edit**, **Machine** and **Details**. Select one text item and choose **Edit selected text** to load and focus its editor. Fonts, spacing and less common actions stay in expandable sections, with larger touch targets and inputs for small screens. Numeric fields allow a blank or partial value while you type and validate when you submit. A compatible MCP Apps host can show the workspace panel with selection, Undo/Redo and separately approved machine controls when `get_workspace_preview` is called; other MCP clients receive the standard image result. Public ChatGPT plugin approval and UI support on each client remain separate from server implementation.

Edits use the existing Undo, dirty-state and autosave behaviour. Each change carries the current document revision and a unique request ID. Local edits, Undo/Redo and opening a different document invalidate an old revision. A client must read the current workspace before retrying a stale change.

Duplicate-request records use bounded edit windows. When an idle window fills, the app renews its revision and asks the client to read the workspace again. Remote editing can then continue without restarting KerfDesk. A pending write is never discarded to renew a window.

`review_job` reuses an exact current desktop review or prepares a current read-only review through the same job preparation logic. It reports actual compilation warnings, bounds, timing when available, and independently checked spatial Frame status. Artwork and operation counts are workspace totals; warnings, bounds and timing refer to the current output scope. It can report preparing or unavailable when current facts cannot be established. It never approves or starts a job. Preview bounds describe artwork coordinates; review bounds describe the prepared program's output coordinates, so the values can differ.

## Jog, Frame and Start

Request **machine control** on the phone pairing page or request `kerfdesk:control` during MCP sign-in. Explicitly select **Allow Jog, Frame, Start and Abort** on the PC. Existing viewing/editing approvals gain no machine permission; reconnect with a new approval if you want to add it. The matching updated desktop and relay are both required. Controls remain unavailable when an older build cannot provide current machine facts or control authority.

The **Machine** view shows controller activity, labelled position and actual supported axes. Jog buttons make one discrete step using the PC's direction convention and feed limits. Enter a step and speed, then tap an arrow. There is no continuous hold-to-jog through the network in this phase. A parsed controller acknowledgement does not mean the movement has finished; status follows the owned motion through settlement.

Choose **Frame** to trace the current job through the ordinary desktop framing flow. When it completes, choose **Review job**. The remote review shows the current summary, warnings and native acknowledgement prompt. Choose **Start job** to confirm that exact review. If preparation or live facts changed it, inspect the refreshed review and confirm again. A completed Frame for unchanged placement remains the sole ordinary Start policy gate. Power and speed changes retain that Frame unless they change the emitted footprint or placement. Policy warnings stay warnings, and licence state adds no machine-control gate.

**Abort job** uses the ordinary desktop Abort action and remains available while another remote request is pending. It requires a working connection; use the physical emergency stop when necessary. No remote tool changes the machine connection, homes it, sends console/G-code, fires an arbitrary laser pulse, executes shell commands or reads arbitrary files.

The MCP commands are `get_machine_status`, `get_control_operation`, `jog_machine`, `frame_job`, `review_machine_job`, `start_job` and `abort_job`. Each consequential command has a caller-generated UUID; its operation ID is that same value. An accepted receipt means the PC accepted work, not that physical movement or a job completed. Poll operation and machine status for the outcome. The review handle is one-use and belongs to that client, session and exact flow.

If a reply is lost, choose **Check status** with the same operation ID. Never automatically issue another jog or Start with a fresh ID. The relay durably consumes admitted action IDs before dispatch, refuses conflicting payloads and retains uncertain results across reconnects. A renderer replacement can leave an outcome unknown; it cannot redispatch that old action. Active approval records have bounded action capacity without evicting replay guards. When it fills, create a fresh pairing approval. Machine polling does not replace text, workspace or numeric drafts.

## Disconnect, restart and privacy

Revocation cancels pending requests. Turning access off closes the connection immediately and saves a pending revocation so it must be completed before access is admitted after reconnecting. Closing, reloading or replacing the desktop workspace also cancels its outstanding requests. Pending machine preparation and owned jog/Frame retain live permission and session checks before subsequent dispatch; cancellation cannot act on a replacement controller. A normal job already handed to the streamer retains its ordinary run lifecycle. A timeout or broken connection can leave a client uncertain whether a completed edit or machine action was received. Retain its request ID and inspect status before attempting a different action.

The computer's remote credentials and opt-in are saved in a separate encrypted file using operating-system secure storage. They are separate from the Pro licence. If secure storage is unavailable, remote access stays unavailable and ordinary desktop use continues.

Approved requests and projected workspace data pass through the first-party Cloudflare relay. An MCP app may also send them to its AI provider. Previews and text contents require the separate sharing opt-in. Operation labels stay generic while sharing is off because they can contain text wording. Licence/payment credentials, serial-port identities, saved file paths and complete project files are excluded. See the active [privacy notice](https://kerfdesk.com/privacy/) for the implemented retention and session limits.

Cloudflare quotas and network outages can interrupt remote access. The service makes no model API calls and requires no customer OpenAI API key. It does not purchase a Cloudflare plan or remove client subscription requirements.

## Qualification boundaries

Protocol, runtime, native secure-storage, rendered phone-page and live desktop/client checks are distinct evidence. None substitutes for physical-machine qualification. Public ChatGPT plugin review, actual phone-device testing, paid customer activation and Windows reboot/power-loss qualification must be reported separately.

Successful ChatGPT endpoint discovery is separate from OAuth completion, PC approval and authenticated viewing/editing. Automatic ChatGPT scope escalation also needs a live client check; the supported metadata mirror and standard HTTP challenges alone do not establish that its tool-level linking UI will appear.

## Primary references

- [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI authorization guide](https://developers.openai.com/plugins/build/auth)
- [OpenAI tool metadata reference](https://developers.openai.com/plugins/reference)
- [OpenAI ChatGPT UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Connecting a ChatGPT plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/authorization/)
