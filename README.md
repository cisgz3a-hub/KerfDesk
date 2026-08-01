# KerfDesk

KerfDesk is a local-first CAM application for laser cutters, engravers, and CNC
routers. The same TypeScript/React codebase ships as a browser app and a Windows
Electron app. It imports or creates artwork, assigns laser or CNC operations,
previews the prepared job, emits G-code, and streams supported controllers.

The repository's internal name remains LaserForge 2.0. KerfDesk is the product
name.

> KerfDesk controls machines that can cause fire, eye injury, toxic exposure,
> cuts, and uncontrolled motion. Read [`docs/safety.md`](docs/safety.md), inspect
> every job, run Frame with output disabled, and keep an independent physical
> emergency stop or power-isolation method available. Software checks are not a
> substitute for supervision or manufacturer guidance.

## Current development status

The application includes laser and CNC workflows, multi-controller support,
camera and registration tools, text/trace/raster processing, material workflows,
box generation, and Phase L Image Studio editing. Implementation status,
hardware qualification, and future scope are tracked separately in
[`PROJECT.md`](PROJECT.md). Do not treat a green software test as physical burn or
machine qualification.

## Development

Requirements: Node.js 22.13 or newer and pnpm 11.3.x.

```powershell
pnpm install --frozen-lockfile
pnpm dev:web
```

Common commands:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm test:e2e
pnpm build:web
pnpm build:desktop
pnpm release:check
```

`pnpm release:check` is the complete blocking CI/release gate. The Playwright
browser-smoke workflow runs separately and does not currently gate deployment.

## Documentation

Start with [`docs/README.md`](docs/README.md).

- [`AGENTS.md`](AGENTS.md) — repository operating contract for AI agents
- [`CLAUDE.md`](CLAUDE.md) — engineering standards and enforcement map
- [`PROJECT.md`](PROJECT.md) — current product scope and qualification status
- [`WORKFLOW.md`](WORKFLOW.md) — operator flows
- [`DECISIONS.md`](DECISIONS.md) — architecture decision records
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution and verification process
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting and trust boundaries
- [`RESEARCH_LOG.md`](RESEARCH_LOG.md) — dependency and external-claim evidence

Dated audit reports are preserved as evidence snapshots and indexed in
[`docs/audits/README.md`](docs/audits/README.md); they are not current product
truth by themselves.

## License

KerfDesk source is available under the [MIT License](LICENSE). Bundled third-party
software and fonts retain their own licenses; see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
