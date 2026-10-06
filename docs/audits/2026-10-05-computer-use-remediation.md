# Computer-use audit remediation, 5 October 2026

The original audit exercised 52 UI cases against `0.1.3014 / 1212c540`, including
editing, native project files, imports, tracing, generators, laser/CNC output and a
225,660,453-byte project containing 51,000 contours. Remediation incorporates the
Line Art-only Free boundary from PR #1071 and main through `14eef624ce`.

## Tracing

Line Art is the sole Free preset. All seven other visible presets, including Sharp,
display Pro labels and route through `advanced-trace`. Browser-Free builds strip
the Pro preset tables and select Line Art for new tracing work. Existing operations
remain usable, including their output. Native Chrome UI retesting confirmed every
Pro selection opens the notice and Line Art still traces and commits successfully.

## Manual project Save

Large saves validate and serialize captured project data in a short-lived worker.
First Save and Save As prepare before offering a fresh **Choose file…** click, so
validation cannot consume the native picker's transient activation. Small saves
keep their direct picker. Retained targets need no new picker. Cancellation releases
the worker lane; failures do not fall back to large synchronous validation.

Canonical validation, semantic drift refusal, dirty-state ownership and destination
write reconciliation still apply. Raw recovery export remains a separate action.
Canonical packing requires exact geometry shapes; malformed values and extra geometry
properties reach validation unchanged. Recovery transfers the original graph and
prepares its raw serializer bytes before a fresh **Choose recovery file…** click.
See [ADR-204 Amendment 1](../decisions/ADR-204-amendment-1-background-manual-project-save.md).

Actual Chrome testing cancelled preparation while the file-choice button was
disabled, cancelled a ready choice, then saved the full stress project through the
native picker. The saved file was exactly 225,660,453 bytes with the original SHA-256
`e921ef2513e982e0bb4761adbb9322bbf2eaebc42ba90927b38cdd1093d0a54f`.

## Worker geometry transfer

Packed geometry now uses one aligned outbound backing buffer instead of one buffer
per typed array. The cached source geometry remains attached and unchanged. The
stress project's 459,000 buffers become one; native worker transfer, unpacking and
strict comparison preserved every project property.

Isolated Node measurements over 10,000 paths changed sender time from 3.4–6.5 seconds
to 19–20 ms. The complete 51,000-path sender took 102–107 ms, with warm packing taking
72–76 ms. These measure the Node handoff, not Chrome interaction time or total Save.

## Startup cache and remaining qualification

The cached startup follows the documented offline PWA/manual-update contract. Chrome
showed the update offer; applying it changed the visible build to `0.1.3017 / 77551143`.
Nine focused PWA suites passed 67 tests. No app cache-policy change was justified.

A separate delivery discrepancy remains: `kerfdesk.com/sw.js` returns
`Cache-Control: max-age=14400`, while the matching Pages-host script returns
`no-cache`. Their bytes match, and source/build headers prescribe `no-cache`.
Provider cache rules, response-header transforms and browser TTL need read-only
inspection before a provider correction. This finding does not establish the cause
of the original stale startup or a four-hour service-worker update delay: the default
`updateViaCache: imports` bypasses the main script's HTTP cache during update checks.

The in-app browser's native Save-picker limitation is environmental; native Chrome
is the qualified browser here. The PR does not qualify a packaged Electron build,
deployment, provider configuration, controller motion or material results.
