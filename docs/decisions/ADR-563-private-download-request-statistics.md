## ADR-563 - Private aggregate download request statistics (2026-09-30)

**Status:** Implemented in source; live access requires an owner analytics-read credential

The owner requested a way to see how often the desktop app is downloaded. The
existing fixed `dl.kerfdesk.com` addresses and signed download contracts remain
unchanged. The browser, desktop app and product website gain no tracking script.

A local owner dashboard queries Cloudflare's existing zone HTTP request metrics.
It checks dataset access and limits, then groups recognised installer requests by
UTC day, version, platform, channel and request country. HTTP 200 and 206 counts remain separate.
Counts are labelled estimated download requests, never people, installations or
completed transfers. Adaptive sampling, retries, automated requests, update
downloads and retention limits are visible limitations.

Country is Cloudflare's estimate for the request's network address, not a person's
residence. VPNs and proxies can change it. The dashboard displays country names,
exports two-letter country codes and retains only aggregate counts. Unavailable
countries use `unknown`. Existing history without a country remains compatible
and is labelled Unknown; a refresh replaces a covered day's old aggregate rather
than adding country rows to it. Duplicate detection includes the country dimension.

The owner provides a read-only analytics credential to a loopback server. It is
kept in memory, never stored in browser storage, returned through an API or
written to the aggregate history. Host and Origin checks protect the local
server. No provider credentials ship with the app or website.

Only aggregate daily observations are saved on the owner's computer. A refresh
replaces an overlapping observation; narrower retention coverage never replaces
wider saved coverage. Errors do not overwrite data with zero. Missing periods
remain gaps, and saved observations are not represented as all-time totals.

This is a narrow clarification of PROJECT.md non-negotiable 8: no app usage,
project, job or machine telemetry is added. The hosting service already receives
normal download requests; the owner can now inspect their aggregate counts.
The product privacy page discloses this download-host use. No licence or EULA
terms change, and no server deployment is necessary for this local tool.
