# Development-tool dependency remediation - 2026-09-19

The full dependency audit at main `7d4b8281` reported 32 affected package/version entries (19 high, 13 moderate) across ten development-tool package names. The production-only audit was clean. This change updates the affected tooling without changing production direct dependency resolutions, Electron 42.11.5, Vite 6.4.3, product behavior, or publication state.

## Selected versions

| Package | Previous | Selected | Selection |
| --- | --- | --- | --- |
| Vitest, mocker, coverage provider | 3.2.6 | 4.1.11 | The security fix is not backported to 3.x; runner/provider are pinned together. |
| `@xmldom/xmldom` | 0.8.13 | 0.8.15 | Patched 0.8 line preserves the plist consumer API. |
| `baseline-browser-mapping` | 2.10.32 | 2.11.0 | Patched same-major data package. |
| `browserslist` | 4.28.2 | 4.28.7 | Patched same-major Babel/build closure. |
| `fast-uri` | 3.1.4 | 3.1.6 | Existing override moves within major 3. |
| `nanoid` | 3.3.12 | 3.3.19 | Patched CommonJS-compatible major 3; 3.3.18 security floor. |
| `postcss` | 8.5.18 | 8.5.28 | Existing override moves within 8.5. |
| `sharp` | 0.35.0 | 0.35.4 | Existing override moves within 0.35; native build verified separately. |
| `undici` | 6.27.0 / 7.28.0 | 6.28.1 / 7.29.1 | Separate major-preserving overrides retain caller compatibility. |

The selected releases were published between July 21 and September 10, 2026. Registry release timestamps, package engines and licenses were checked on September 19. Vitest 4 supports the existing Vite 6 and Node 22 toolchain. No release-age exception or advisory suppression was added. Packages retain permissive MIT, Apache-2.0 or BSD-3-Clause licenses; production license checks remain mandatory.

## Migration and evidence

Vitest 4 distinguishes callable mocks from constructor mocks. Nine test/support files now name the application function signature they mock instead of taking the return type of an unspecialized generic. Existing assertions and production code remain unchanged.

The previous coverage regression imported Vitest 3's private `test-exclude`/`glob` dependency chain. Vitest 4 uses a different coverage implementation. Its replacement executes the installed runner and V8 provider against a small fixture and checks that a brace pattern includes both the covered file and an unimported, uncovered file. Production coverage include/exclude policy is preserved.

Validation receipts are kept under the isolated worktree's ignored `artifacts/dependency-remediation-20260919/` directory. The refreshed full and production-only npm audits both report zero advisories. Frozen installation and the actual coverage-provider/ESLint brace smoke pass. Full release components, full Vitest suite, final frozen-head package verification and hosted checks are recorded at PR handoff; no incomplete run is a passing gate.

An npm audit result is scoped to the current advisory database and dependency graph. It does not certify the Electron/Chromium binary or hardware behavior. No desktop tag, signed release, account provisioning or hardware action is part of this remediation.

## Primary references

- [Vitest advisory and maintained fix lines](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)
- [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration)
- [npm registry package metadata](https://registry.npmjs.org/vitest)
- Advisory URLs and exact affected paths are retained in the baseline audit JSON; selected-version release dates are retained in `selected-release-dates.json`.
