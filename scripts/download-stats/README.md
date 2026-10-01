# Private download dashboard

Run `node scripts/download-dashboard.mjs`, then open <http://127.0.0.1:4318>.
This owner dashboard runs only on your computer. It does not publish a website,
change an installer URL, alter the updater, or add tracking to the app.

## Connect once per session

Create a Cloudflare API token with **Account / Account Analytics / Read**, scoped
to the account hosting `kerfdesk.com`, following the
[official token guide](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/).
Copy the Zone ID from the `kerfdesk.com` overview. Enter both into the local form.
Do not use the licensing administrator token or the R2 publishing token.

The form sends the token only to the loopback server, which uses it only with
Cloudflare's fixed GraphQL endpoint. It is held in process memory, never written
to disk or returned to the browser. Disconnect or stop the command to forget it.
The dashboard rejects foreign origins and Host headers. For local automation,
the same credentials can be supplied through `CLOUDFLARE_ANALYTICS_API_TOKEN`
and `CLOUDFLARE_ANALYTICS_ZONE_ID`; never commit them or paste them into chat.

## Reading the figures

- **Full-response requests** means recognised installer GET requests with HTTP 200.
- **Partial requests** means HTTP 206, including range requests and resumptions.
- Both are request estimates, not people, completed downloads or installations.
  Repeat downloads, updater downloads, bots and operator checks can contribute.
- HEAD requests, manifests, failures and unknown paths are excluded. All dates use UTC.
- **Request country** is Cloudflare's country estimate for the request's network
  address, not a person's residence. VPNs and proxies can show another country.
  Missing country data and saved records from before this breakdown are **Unknown**;
  the dashboard never invents countries for older totals.
- The live dataset's Settings determine retention, available fields and query
  limits. Unsupported or failed queries display an error, never a zero count.
- Refresh saves daily aggregate snapshots under
  `%LOCALAPPDATA%\KerfDesk\download-stats\history.json` on Windows, or
  `~/.local/share/KerfDesk/download-stats/history.json` elsewhere. No IP addresses,
  device IDs, licence details, credentials or project data are stored.
- A refresh replaces an overlapping observation rather than adding it again.
  A retention-clipped day cannot overwrite a previously complete day. The current
  day remains provisional. Saved observations can contain gaps and are **not an
  all-time total**. Refresh within Cloudflare's retention period to avoid gaps.
- Export CSV saves the selected live report's daily per-release and country
  aggregate rows. Country uses a two-letter code or `unknown`.

Cloudflare can [sample and estimate traffic](https://developers.cloudflare.com/analytics/graphql-api/sampling/).
The dashboard uses the already scaled `count`; it does not multiply it again.
On Free, the documented retention is seven days; actual Settings are checked each
refresh. A retention-clipped interval starts 142 seconds inside that boundary,
covering the bounded report and final request while the provider's cutoff moves.
The coverage records that actual interval, so the oldest partial day never becomes
a complete saved day. Older history cannot be recovered unless it was saved while available.
See [Settings](https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/)
and [Security Analytics retention](https://developers.cloudflare.com/waf/analytics/security-analytics/).

No background schedule is installed. Leaving this dashboard closed does not
record additional snapshots. Downloads and app updates continue independently.

## Verification

Run `node --test scripts/download-stats/*.test.mjs`. The suite uses synthetic
GraphQL replies and a real loopback HTTP server, with no production writes.
Local checks do not establish that a given token can read the live zone; connect
the read-only credential and verify the first report's coverage in the dashboard.
