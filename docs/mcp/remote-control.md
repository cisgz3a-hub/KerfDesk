# Phone and MCP access

Remote access connects the desktop workspace to a separate phone control page and standard MCP clients. It starts turned off. The computer must be awake, online and running KerfDesk. The ordinary mobile landing page remains the licence/download page.

## Connect a phone

1. On the computer, open **Settings > Phone & MCP** and enable **Allow approved remote connections**.
2. Wait for **Connected to the remote service**. Create a pairing code.
3. On the phone, open the phone-page address shown in Settings. Enter the computer ID and pairing code. A link opened from Settings already includes the public computer ID.
4. Approve the named connection on the computer. Choose **Allow viewing** or **Allow viewing and editing**.
5. The phone page displays the current workspace and its available controls. It does not mount the desktop canvas.

Codes are usable once and expire after five minutes. Pairing is not a Pro licence or a computer activation. A phone connection can be revoked from the same Settings section.

## Connect ChatGPT or another MCP app

Add this Streamable HTTP MCP URL in a client that supports authenticated remote servers:

`https://kerfdesk-phone-control.cisgz3a.workers.dev/mcp`

Use the OAuth sign-in page to enter the computer ID and a new pairing code, then approve the requested permissions on the computer. The client receives access to that computer only. The authorization page and the desktop approval both show the requested access.

ChatGPT's custom-server controls depend on the current plan, workspace and client. Private developer-mode setup and an approved public plugin are separate distribution paths. A working MCP endpoint does not establish availability in every ChatGPT phone app or approval for the public plugin directory. The separate phone control page works through an ordinary supported mobile browser.

## What connections can do

Viewing connections can read bounded artwork and operation summaries, machine limits, edition/update status and material recipes. Editing connections can also:

- select existing artwork;
- move, rotate or resize supported existing artwork;
- create basic text or rectangles in Laser workspaces;
- change an ordinary laser operation's power, speed, passes and enabled state.

Text uses the bundled regular font. Its requested width is a maximum layout width; overflow shrinks uniformly. CNC creation and CNC operation settings are not included. Existing desktop Pro rules still apply.

Edits use the existing Undo, dirty-state and autosave behaviour. Each change carries the current document revision and a unique request ID. Local edits, Undo/Redo and opening a different document invalidate an old revision. A client must read the current workspace before retrying a stale change.

There are no machine-connection, motion, laser/spindle, console/G-code, Frame, Start, shell or arbitrary-file tools. Machine execution remains in the desktop workflow. `review_job` currently reports unavailable because this integration does not own the desktop's prepared-job evidence; it does not claim a completed Frame.

## Disconnect, restart and privacy

Revocation cancels pending requests. Turning access off closes the connection immediately and saves a pending revocation so it must be completed before access is admitted after reconnecting. Closing, reloading or replacing the desktop workspace also cancels its outstanding requests. A timeout or broken connection can leave a client uncertain whether a completed edit was received; inspect the current workspace before attempting another change.

The computer's remote credentials and opt-in are saved in a separate encrypted file using operating-system secure storage. They are separate from the Pro licence. If secure storage is unavailable, remote access stays unavailable and ordinary desktop use continues.

Approved requests and projected workspace data pass through the first-party Cloudflare relay. An MCP app may also send them to its AI provider. Licence/payment credentials, serial-port identities, saved file paths and source artwork payloads are excluded. See the active [privacy notice](https://kerfdesk.com/privacy/) for the implemented retention and session limits.

Cloudflare quotas and network outages can interrupt remote access. The service makes no model API calls and requires no customer OpenAI API key. It does not purchase a Cloudflare plan or remove client subscription requirements.

## Qualification boundaries

Protocol, runtime, native secure-storage, rendered phone-page and live desktop/client checks are distinct evidence. None substitutes for physical-machine qualification. Public ChatGPT plugin review, actual phone-device testing, paid customer activation and Windows reboot/power-loss qualification must be reported separately.

## Primary references

- [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI authorization guide](https://developers.openai.com/plugins/build/auth)
- [Connecting a ChatGPT plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/authorization/)
