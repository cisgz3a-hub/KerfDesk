## ADR-523 Amendment 5 - Unsigned commercial Windows delivery (2026-09-30)

**Status:** Approved by the owner; implemented locally, delivery qualification pending.
**Amends:** ADR-523 and Amendment 4; supplements ADR-541 and ADR-540.

The owner approved delivering the finished Windows customer app before purchasing
a Windows code-signing certificate. This is a production licence-enabled build,
not a Sandbox or Preview substitute.

- Explicit `--unsigned-installer` preparation retains the fixed production licence
  endpoint, independent production public trust anchors, and a real Ed25519-signed
  stable release identity. It never embeds public test keys or grants Pro by flag.
- The normal KerfDesk app identity, profile and file association remain intact.
  An unlicensed installation opens Free. Valid trial, paid or developer entitlement
  unlocks Pro through the same verifier as the signed commercial build. Frame,
  Start, output and existing operations retain their existing policy.
- `commercial-unsigned` metadata records `kerfdeskUnsignedInstaller: true` and
  `kerfdeskUpdateChannelTrusted: false`. Packaging explicitly disables Windows
  signing, automatic-update configuration and differential packages, while keeping
  executable resources, fuses and ASAR integrity checks.
- Manual customer downloads use a separate signed manifest and distribution path.
  They never enter the Authenticode-required commercial update feed. The signed
  preparation and publisher remain strict; choosing this lane cannot loosen them.
- The installer contains the approved commercial terms and required first-party
  and third-party notices. Windows may identify an unsigned download as from an
  unknown publisher; the download page must say that clearly.

Qualification must bind the downloadable installer to its verified packaged
production metadata and confirm Free startup and valid entitlement behaviour.
Unsigned distribution does not establish Windows publisher reputation or hardware
qualification. A later signed release may use the existing production identity,
but its automatic-update lane still requires the original signature checks.
