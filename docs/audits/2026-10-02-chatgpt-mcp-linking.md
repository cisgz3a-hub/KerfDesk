# ChatGPT MCP linking audit

Reviewed 2 October 2026 against main `79653c811a314e68ce28c32a928e847afae51485`.

## Findings and repairs

- A bearer token whose PC approval was unavailable reached an application-owned `401 invalid_token` response without `WWW-Authenticate`. The relay now returns a fixed Bearer challenge with its canonical `/mcp` resource metadata address. The description contains no submitted token, arguments or device identity. Provider-owned authentication failures retain the provider's own challenge.
- Remote tool descriptors now carry the SDK-supported `_meta.securitySchemes` declaration for their existing read or edit permission. Registration through SDK 2.2.0 does not serialize an arbitrary top-level `securitySchemes` property, so this repair does not introduce an unsupported protocol adapter. The stdio server continues to omit remote OAuth requirements. Permissions still come from the approved PC connection and OAuth grant.
- The website and remote-access guide now explain ChatGPT's current web setup and the explicit editing scope. A read-only grant still refuses writes before contacting the PC.

## Verification and limits

The independent source reproduction captured the missing challenge, and tightened wire metadata and reauthorization regressions failed on the baseline. Official SDK clients cover legacy and modern Streamable HTTP in local workerd. A dedicated reauthorization case checks an application-owned refusal separately from refresh/replay failures handled by the OAuth provider. The completed command results are recorded with the reviewed source in the external delivery evidence.

In the signed-in ChatGPT web UI, OAuth discovery selected CIMD, `https://chatgpt.com/oauth/client.json`, the stable `https://chatgpt.com/connector_platform_oauth_redirect` callback, S256, and the correct KerfDesk issuer and `/mcp` resource. Its default scope was `kerfdesk:read`. Adding `kerfdesk:edit` as a base scope reached KerfDesk's authorization and pairing page with both requested permissions.

This is discovery and setup evidence, not a completed authenticated ChatGPT connection. No customer computer ID, pairing code, authorization code or token was submitted. Actual approved-PC viewing/editing and automatic ChatGPT tool-level scope escalation remain unverified. Standard transport challenges and the supported metadata mirror do not establish OpenAI's additional tool-result linking UI.

The corrected Worker has not been deployed: protected Cloudflare management reads returned HTTP 429 despite backoff. The website's guide can publish separately, but source checks and a PR merge do not prove the service was updated. Desktop installer publication, live relay qualification and physical-machine evidence remain separate.

## Primary references

- [OpenAI: connect to ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI: authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI: tool metadata](https://developers.openai.com/plugins/reference)
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

