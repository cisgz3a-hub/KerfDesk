> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Cybersecurity, Program Integrity, Networking, DNC, and Remote Operations

Date: 2026-07-13
Snapshot: e752a9125f02f832144c3b40800840ee5973fcf2
Scope: CNC and OT network architecture, DNC and network-file execution, remote observation and control, controller APIs, identity and authorization, program and update provenance, auditability, backup/restore, interruption recovery, public CNC sender/controller implementations, and the current KerfDesk trust boundary
Method: official standards and specifications, official controller/vendor documentation, pinned public-source inspection, direct inspection of C:\Users\Asus\LaserForge\audit-current-main, and focused verification tests

## Executive verdict

Cybersecurity in CNC software is machine safety.

A compromised sender does not merely disclose a file. It can move axes, start a spindle, alter offsets, replace a program, flash controller firmware, change PLC-facing state, invalidate a collision model, or create a convincing but false machine display. Conversely, a perfectly authenticated request can still be physically unsafe because the bit is embedded, the wrong work offset is active, the guard is open, a tool was changed, a clamp is unproved, or an interrupted action completed after the network response was lost.

The correct trust equation is:

~~~text
authenticated identity
+ operation-specific authorization
+ exclusive command ownership
+ immutable job and configuration identity
+ fresh authoritative controller state
+ locally proved physical permissives
+ machine-specific safety sequence
= eligible request
~~~

Even that produces only an eligible request. The controller and validated safety system, not the browser, cloud service, VPN, telemetry agent, or desktop UI, must decide whether hazardous action may execute.

The deepest findings are:

1. **Remote access is not one capability.** Siemens, Haas, FANUC, HEIDENHAIN, Okuma, and Mazak publicly distinguish viewing, telemetry, file transfer, editing, selection, execution, PLC access, backup, and update. A single remote-control Boolean is an architectural defect.
2. **Monitoring and command need different trust planes.** MTConnect is explicitly read-only and side-effect-free. Mazak SmartBox similarly uses read-only monitoring. Telemetry must not quietly become a motion API.
3. **A secure channel does not make a safe command.** OPC UA can authenticate, encrypt, authorize, and audit, but a batch Write may partially succeed, a Method may continue after the Session disappears, and an accepted asynchronous result is not physical completion.
4. **Network progress is not process progress.** Last byte sent, last line uploaded, last response received, last block accepted, last trajectory planned, and last irreversible physical action are different positions.
5. **Program name is not program identity.** Safe activation and recovery require the digest of exact accepted bytes plus compiler/post, machine profile, firmware/configuration, tools, offsets, fixture/setup, and approval identity.
6. **DNC needs a two-phase transaction.** Upload to quarantine, read back or obtain a controller-side digest, validate, immutably activate by digest, then authorize execution. Never execute a mutable filename or share path merely because it was previously approved.
7. **Timeout means outcome unknown.** If a remote Start, clamp, offset write, or Method call loses its reply, retrying can duplicate physical action. Commands require durable IDs, idempotency, reconciliation, and controller-side state versions.
8. **The safety path must survive IT failure.** E-stop, guard interlocks, safety PLCs, drive inhibits, and local safe stop cannot depend on cloud reachability, an identity provider, a log collector, or a general-purpose application process.
9. **Backups are executable machine state.** They can contain PLC logic, parameters, offsets, macros, compensation, users, network settings, programs, and security material. A backup is not proved until a compatible restore drill succeeds.
10. **Public sender/controller software exposes real trust-boundary defects.** At the pinned commits, FluidNC compiles authentication out by default and treats unauthenticated web clients as administrators; gSender has an always-true IP authorization check, an unconditional JWT error bypass, and unauthenticated Socket.IO command/flash/raw-write surfaces; cncjs has materially better authentication but still treats private networks as trusted and issues an anonymous token when no users exist.
11. **KerfDesk has a much smaller current network attack surface than those server products.** Machine control is local Web Serial/USB; Electron isolation and navigation controls are strong; external G-code is preview-only; the desktop updater is deliberately disabled. Its important remaining trust gaps are hosted-origin/Web Serial supply-chain authority, unsigned desktop releases, non-cryptographic job checkpoints, descriptive rather than cryptographic G-code provenance, volatile logs, and a camera bridge whose trusted web origins can reach private-network cameras.
12. **The interrupted-bit example is a state-classification problem.** “Move before spindle” and “spindle before motion” are both unsafe as universal rules. If the cutter is embedded, software must know or conservatively classify engagement, choose a process-specific escape, prove clearance, establish spindle direction and at-speed, and re-enter under controlled feed. A line number cannot decide that sequence.

The governing boundary is:

> Display is not control. Transfer is not activation. Selection is not Start. Authentication is not readiness. An archive is not recoverability. A network acknowledgement is not physical completion.

This tranche is research and architecture. It does not enable remote control and does not modify production code.

## 1. Questions this tranche answers

This research asks:

- What assets and physical consequences belong in a CNC cybersecurity model?
- How should enterprise, OT DMZ, cell, controller, safety, and field zones be separated?
- Which protocols are observation-only, which can write state, and which can execute programs?
- What does a secure remote command contract need beyond login and TLS?
- How do DNC, shared folders, FTP, SMB, controller data servers, and streaming change job identity?
- How do partial writes, timeouts, retries, reconnects, and controller resets affect physical truth?
- What do industrial vendors actually expose for remote display, transfer, editing, Start, PLC access, backups, and updates?
- What security assumptions are present in FluidNC, gSender, and cncjs?
- What is KerfDesk's present attack surface and what would change if remote control were added?
- How should programs, checkpoints, releases, firmware, backups, and audit records be made tamper-evident?
- Which invariants and adversarial tests should be mandatory before network control is commissioned?

It does not claim IEC 62443 certification, machinery-safety conformity, penetration-test coverage, or machine-specific remote-start approval. Those require a defined system boundary, licensed standards where applicable, an asset-owner risk assessment, the OEM machine manual, the machine builder's PLC/safety design, and evidence from the deployed cell.

## 2. Evidence method and confidence

### 2.1 Evidence classes

| Class | Meaning |
| --- | --- |
| Normative | A requirement or semantic contract in a published specification or standard |
| Official guidance | A recommendation from NIST, CISA, an OEM, or another authoritative publisher |
| Source-confirmed | Behavior read directly in a pinned public repository or this snapshot |
| Documentation-confirmed | Behavior stated in official vendor documentation but not reproduced on hardware |
| Engineering inference | A design conclusion derived from the evidence rather than a quoted requirement |
| Runtime-unconfirmed candidate | A suspicious source path whose complete runtime exploitability or behavior was not reproduced |

The document keeps those categories separate. In particular:

- IEC/ISA public previews establish concepts but do not support a formal conformance claim.
- Vendor public pages do not expose every machine-builder interlock.
- A source-level authorization defect is not presented as a network penetration test.
- Absence of visible signature verification in one code path is not proof that no platform layer ever performs verification.
- Safety applicability depends on machine class, options, integration, and actual risk assessment.

### 2.2 Pinned public repositories

| Project | Commit inspected | Purpose |
| --- | --- | --- |
| FluidNC | 94e8adbbc17fde3e29d025e4c91b8dbcf76109e3 | Embedded controller web/DNC/auth/update surface |
| gSender | 43f841edf89bc346163af10f6b0087d56ca9fadb | Desktop/headless sender server, REST, Socket.IO, firmware flashing |
| cncjs | fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1 | Sender/server comparison and inherited trust assumptions |
| KerfDesk snapshot | e752a9125f02f832144c3b40800840ee5973fcf2 | Current product boundary and gap analysis |

Local clones are research evidence only. No copied implementation is made authoritative for KerfDesk.

## 3. The cyber-physical threat model

### 3.1 Assets

The protected asset is not merely “the G-code file.” A useful inventory includes:

~~~text
people and bystanders
machine, spindle, drives, axes, guarding, and safety functions
workpiece, stock, fixture, clamps, vacuum, and material ownership
tools, holders, tool table, offsets, probing and calibration
exact program bytes and controller-resident representation
CAM, compiler, emitter, postprocessor, dialect, and machine profile
PLC logic, parameters, macros, compensation, drive data, and firmware
work coordinate systems and runtime modal/controller state
interruption checkpoint and physical recovery evidence
identities, roles, certificates, keys, sessions, and command leases
audit records, clocks, incident evidence, backups, and restore tooling
release artifacts, update metadata, signing identity, and provenance
network topology, firewall rules, jump hosts, agents, shares, and gateways
~~~

The safety consequence of corrupting one asset often appears through another. A valid job can become unsafe after a tool-table change. A valid checkpoint can become unsafe after a controller reset. A signed release can still be the wrong release for a controller option. A true screen can become misleading after its telemetry source goes stale.

### 3.2 Actors and failure origins

The model must cover more than a skilled external attacker:

- unauthorized Internet or LAN client;
- compromised browser tab or hosted web origin;
- compromised engineering laptop or vendor support device;
- malicious or mistaken authenticated operator;
- over-privileged integrator or service account;
- compromised update pipeline, object store, or DNS route;
- changed network share, remounted path, or reused filename;
- malware on an OT workstation;
- stale Session or leaked bearer token;
- default/shared credential;
- certificate or signing-key compromise;
- buggy sender, controller API, or PLC integration;
- delayed, duplicated, reordered, or lost network message;
- power loss, reboot, buffer overflow, or clock error;
- restore from incompatible or incomplete backup;
- physical intervention not reflected in software;
- false, stale, partial, or semantically incoherent telemetry.

Security design that protects only against an anonymous outsider misses many realistic CNC failures.

### 3.3 Entry points

Potential entry points include:

- Web Serial and USB controller access;
- serial-over-network bridges;
- embedded controller HTTP and WebSocket servers;
- sender REST and Socket.IO APIs;
- OPC UA Browse, Read, Write, Call, History, and file transfer;
- MTConnect HTTP endpoints;
- FTP, TFTP, SMB, NFS, SSH/SFTP, WebDAV, and vendor DNC;
- controller data servers and network shares;
- remote desktop, VNC, RDP, VPN, and jump hosts;
- vendor cloud portals and mobile applications;
- removable USB media;
- camera bridges and private-network proxies;
- update feeds, manifests, installers, firmware images, plugins, and macros;
- project files, G-code imports, backups, recipes, tool libraries, and configuration archives;
- log forwarding, time synchronization, and monitoring agents.

Every entry point needs a documented answer to:

~~~text
What may it observe?
What may it mutate?
Can it produce motion or energy?
Can it change future motion indirectly?
What identity is authenticated?
What exact operation is authorized?
How is local presence established?
Who owns the command channel?
How are bytes and configuration identified?
What happens on timeout or partial completion?
What evidence survives reboot?
How is it disabled quickly without harming the process?
~~~

### 3.4 Security failure is not identical to safety failure

Authentication, authorization, encryption, signing, segmentation, and logging reduce security risk. They do not replace:

- guard interlocks;
- safety-rated E-stop and stop functions;
- safe torque off;
- drive and spindle permissives;
- machine limits;
- workholding proof;
- collision avoidance;
- controller-side sequencing;
- local mode selection;
- a machine-specific risk assessment.

Security and safety must exchange state without collapsing into each other. A safety trip should invalidate execution authority and recovery evidence. A cybersecurity isolation action must be assessed for process consequences. Yet a network, cloud, or identity outage must never disable the local safe-stop path.

## 4. Zones, conduits, and trust planes

### 4.1 IEC/ISA 62443 framing

IEC/ISA 62443-3-2 defines a risk-assessment process based on the system under consideration, security zones, conduits, target security levels, and documented requirements. IEC/ISA 62443-3-3 groups system requirements under seven foundational requirements:

1. identification and authentication control;
2. use control;
3. system integrity;
4. data confidentiality;
5. restricted data flow;
6. timely response to events;
7. resource availability.

The series assigns responsibilities across asset owners, service providers, system design, components, patching, and secure product development. [ISA/IEC 62443 series](https://www.isa.org/standards-and-publications/isa-standards/isa-iec-62443-series-of-standards), [ISA 62443-3-2 preview](https://www.isa.org/getmedia/661c718f-8e64-446d-acf9-2c6286db1b33/isa-62443-3-2-preview.pdf), [ISA 62443-3-3 preview](https://www.isa.org/getmedia/d73509e9-b626-4709-a406-be6fc7616b79/ISA-62443-3-3_Preview.pdf)

This report uses that architecture but is not an IEC 62443 conformance assessment.

### 4.2 Recommended CNC zones

| Zone | Typical contents | Governing rule |
| --- | --- | --- |
| Enterprise/cloud | ERP/MES clients, analytics, email, browsers, vendor portals | No direct controller route |
| OT DMZ | VPN terminator, jump host, command broker, update staging, historian relay, central audit collector | Mediate and terminate cross-boundary access |
| Cell supervisory | Local HMI, cell controller, engineering station, MTConnect agent | Machine-scoped, purpose-scoped access |
| Controller | CNC, PLC, native controller API, local program store | Authoritative execution and machine state |
| Safety | Safety PLC, relays, guard and E-stop circuits | Independently inhibits hazardous action |
| Field | Drives, spindle, axes, sensors, tool changer, clamps | Not routable from enterprise systems |

### 4.3 Purpose-specific conduits

A single flat “machine LAN” cannot express the required authority. Use separate conduits:

- outbound read-only telemetry;
- inbound command requests;
- staged artifact transfer;
- time-bounded maintenance;
- update delivery;
- central audit export;
- backup/restore under a separately enabled maintenance mode.

Each conduit has its own identities, destinations, protocols, rate limits, freshness expectations, and failure policy. Default deny applies inbound and outbound.

### 4.4 NIST OT guidance

NIST SP 800-82 Rev. 3 recommends defense in depth, enterprise/OT separation, DMZs, restrictive data flows, separate OT credentials, tested patching, audit trails, and segmentation by authority, trust, criticality, location, and required flow. It specifically warns against direct enterprise communication with lower controller/process levels and discusses one-way gateways where appropriate. [NIST SP 800-82 Rev. 3](https://csrc.nist.gov/pubs/sp/800/82/r3/final)

For remote maintenance, the useful design requirements are:

- documented business need;
- least necessary capability and duration;
- unique identity and removal of defaults;
- MFA where appropriate;
- explicit operational notification and monitoring;
- local approval rather than silent automatic approval;
- automatic expiry and prompt removal of temporary connections;
- an obvious rapid-disconnect mechanism;
- tested effects of VPN and security appliances on timing and availability;
- no bypass of safety or security controls;
- OT-initiated connections where the architecture permits.

A VPN is a protected conduit. It is not machine readiness, command ownership, or local consent.

## 5. Observation protocols are not command protocols

### 5.1 MTConnect

The official MTConnect REST API is stateless, read-only, and must not produce side effects on the Agent or equipment. The client owns recovery after connection errors. [MTConnect 2.7 REST protocol](https://model.mtconnect.org/Version2.7/Fundamentals/MTConnectProtocol/RESTProtocol/)

That gives MTConnect a valuable architectural role:

~~~text
controller/source adapter
-> MTConnect Agent
-> cell or DMZ relay
-> dashboards, historian, maintenance, analytics
~~~

It does not give MTConnect authority to start, stop, select, upload, or write offsets.

MTConnect sequence numbers are monotonically increasing within an instanceId. A new Agent instance resets the sequence and must use a new instanceId. Fixed buffers discard old observations, exposing firstSequence and lastSequence. [MTConnect 2.7 Fundamentals](https://model.mtconnect.org/Version2.7/Fundamentals/)

Therefore:

- an instanceId change invalidates all derived readiness;
- a sequence gap requires resynchronization;
- a live HTTP connection does not prove a live controller source;
- UNAVAILABLE means the fact is indeterminate;
- a stale or future timestamp is not current state;
- READY is descriptive, not authorization;
- FEED_HOLD does not prove spindle off, energy isolated, or resumable;
- WAIT may resume automatically and is not equivalent to a manual stop;
- program name cannot prove exact bytes;
- independently sampled observations may not form a transactionally coherent safety snapshot.

The controller must reevaluate start permissives at execution time.

### 5.2 OPC UA

OPC UA can provide:

- application certificates and SecureChannels;
- signing and encryption;
- user authentication;
- role and permission models;
- Browse, Read, Write, Call, and file services;
- security and service audit Events.

It also exposes failure semantics that CNC applications must respect.

OPC UA requires trust checks including certificate chain, application URI, signature, expiry, and revocation processing. Its role model includes roles such as SecurityAdmin, ConfigureAdmin, Engineer, Operator, and Observer, although a server may implement a different or incomplete model. Permissions distinguish browsing, reading, writing, history, event receipt, Method calls, and node management. [OPC UA certificate validation](https://reference.opcfoundation.org/specs/OPC-10000-4/6.1.3), [OPC UA roles](https://reference.opcfoundation.org/specs/OPC-10000-2/4.12), [OPC UA Part 3](https://reference.opcfoundation.org/specs/OPC-10000-3/full)

Critical transactional details are:

- operations within one multi-node Write have undefined processing order;
- a Write may partially succeed and client-side rollback is the client's responsibility;
- operations in one Call request also have undefined order;
- if a Session disappears while a Method executes, the result can be discarded even though server-side action occurred;
- an asynchronous-success status means accepted processing, not physical completion.

[OPC UA Write service](https://reference.opcfoundation.org/specs/OPC-10000-4/5.11.4), [OPC UA Call service](https://reference.opcfoundation.org/specs/OPC-10000-4/5.12.2)

Consequences:

- never implement Start as separate Writes for door lock, spindle, feed, and motion;
- expose a controller-side guarded transition such as RequestStart;
- bind it to command ID, state version, job digest, lease, identity, expiry, and local enable generation;
- treat a lost response as OUTCOME_UNKNOWN;
- query by the same command ID before any retry;
- make repeated command IDs return the prior result or reject;
- distinguish accepted, initiated, at-speed, moving, cutting, complete, aborted, rejected, and unknown.

OPC UA audit Events are useful, but the specification does not make them a guaranteed durable, append-only forensic store. Export correlated client/server audit IDs to an external collector. [OPC UA auditing](https://reference.opcfoundation.org/specs/OPC-10000-4/6.5)

### 5.3 Read-only monitoring must stay read-only

The safest telemetry service:

- has no mutation Methods;
- has no hidden proxy to a command interface;
- uses a distinct network identity and route;
- cannot reuse its token for file transfer or Start;
- is rate-bounded so it cannot starve real-time control;
- exposes source freshness and discontinuity;
- crosses the enterprise boundary through a DMZ relay or one-way pattern where feasible.

This is why “add a Start button to the monitoring dashboard” is not a small UI feature. It changes the system's zone, conduit, authorization, safety, and liability model.

## 6. Remote capability taxonomy

The minimum capability vocabulary is:

| Capability | Example consequence |
| --- | --- |
| observe | Read status, positions, alarms, production counters |
| download | Copy controller data outward |
| upload/stage | Place a candidate artifact in quarantine |
| edit_program | Change future motion |
| write_tool | Change tool identity or geometry |
| write_offset | Shift every later coordinate |
| write_macro | Change hidden program behavior |
| write_parameter | Change control semantics or limits |
| write_PLC | Change machine sequencing/interlocks |
| select_program | Change controller selection without execution |
| activate | Bind an immutable staged digest as eligible |
| cycle_start | Request hazardous execution |
| feed_hold | Request controlled interruption |
| reset | Change control/modal/recovery state |
| jog | Produce immediate axis motion |
| spindle/manual_aux | Produce energy or actuator state |
| firmware_update | Replace the controller trust base |
| backup | Exfiltrate machine logic, credentials, and configuration |
| restore | Replace broad executable machine state |

Roles are sets of narrowly scoped capabilities over particular machines, resources, shifts, and modes. “Administrator” must not be the ordinary execution identity.

## 7. Vendor/controller evidence

### 7.1 Siemens SINUMERIK

Siemens documentation provides the clearest public separation of remote authorities:

- Manage MyMachines remote desktop can display and remotely operate the interface but explicitly cannot initiate machine motion or start NC programs.
- File transfer can move NC files and patches and can update a controller.
- Remote support requires local HMI approval; Siemens advises against automatic approval.
- VNC file transfer is disabled by default and SSH is the recommended encrypted transfer path.
- OPC UA realms distinguish state, frames, tools, drives, files, PLC data, and part-program selection.
- Program selection is not documented as Cycle Start.

[SINUMERIK 828D Industrial Cybersecurity Configuration Manual](https://support.industry.siemens.com/cs/attachments/109974264/828D_IndustrialCybersecurity_config_man_0724_en-US.pdf), [Manage MyMachines /Remote](https://support.industry.siemens.com/cs/attachments/109759394/MMM-R_fct_man_0324_en-US.pdf), [Access MyMachine /P2P](https://support.industry.siemens.com/cs/attachments/109811131/828D_840Dsl_ONE_AMM_op_man_0122_en-US.pdf)

Siemens also documents difficult lifecycle facts:

- classic access management can persist until logout and through restart;
- imported programs, backups, and Technology Extensions affect behavior, while the controller does not itself guarantee their integrity;
- DSF archives can contain NC, PLC, HMI, drive, system, and security data;
- restoring can overwrite or add broad machine state;
- the local Security Eventlog is a bounded, nonpersistent ring and may be cleared by an authorized security administrator;
- external RFC5424 Syslog export is available;
- accurate clocks are necessary for useful evidence;
- controller updates should be staged through segmented infrastructure rather than a direct Internet route.

Consequences:

- reboot is not proof that privilege ended;
- reboot may destroy local evidence;
- programs and backups need application-owned signature/provenance checks;
- central append-only audit export is required;
- restore needs a dry-run inventory and machine/configuration compatibility gate.

[SINUMERIK ONE DSF archive](https://support.industry.siemens.com/cs/attachments/109812289/ONE_cmvm_sys_man_0722_en-US.pdf), [SINUMERIK ONE OPC UA OEM](https://support.industry.siemens.com/cs/attachments/109974031/ONE_OPCUAOEM_config_man_0724_en-US.pdf)

### 7.2 Haas NGC

Haas public documentation separates:

- HaasConnect remote monitoring;
- Remote Display viewing;
- HaasDrop file staging into User Data/My Media;
- local/network shares;
- USB backup;
- controller software update;
- local Cycle Start and door rules.

The public material does not establish Internet Cycle Start from HaasConnect, Remote Display, or HaasDrop.

The network-share documentation exposes legacy and overbroad patterns that a new CNC product should not copy:

- a fixed local share username;
- examples involving broadly writable Windows shares;
- SMB1 can still be enabled;
- some troubleshooting guidance treats patch rollback as a way to restore sharing.

Haas backups are openable ZIP archives and can include settings, offsets, macro variables, advanced tool management, alarm/key history, compensation, network configuration, programs, and all User Data. They are sensitive executable state.

The May 2026 Haas update documentation says automatic updating is not currently operational. Download pauses while spindle or axes run. Installation requires a safe local procedure including E-stop and power cycling and can leave configuration/CRC mismatch alarms. A design must follow current service behavior, not an assumption that “automatic update” is a transparent background operation.

[Haas networking](https://www.haascnc.com/service/online-manuals/next-gen-control-electrical---service-manual/ngc---wire---wireless-networking.html), [Haas backup](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/ngc---backup-machine.html), [Haas software update](https://www.haascnc.com/service/online-manuals/next-gen-control-electrical---service-manual/ngc---software-update.html), [HaasDrop](https://www.haascnc.com/productivity/control/haasdrop.html), [Haas door rules](https://www.haascnc.com/service/troubleshooting-and-how-to/reference-documents/door-rules---run---setup-mode.html)

### 7.3 FANUC

FANUC surfaces include:

- Program Transfer Tool for programs, offsets, and macro variables;
- Data Server transfer and DNC execution;
- FASConnect/FASBacCNC as a Windows service with privilege-controlled access to programs, offsets, parameters, macros, PMC data, pitch-error data, SRAM, user files, and operation history;
- FOCAS read/write APIs;
- FIELD system application and backup integrations.

A “transfer” integration can therefore reach far beyond a job file. Roles must be resource-specific. Data Server FTP and legacy DNC belong in an isolated cell conduit rather than an enterprise LAN. Public FOCAS descriptions support broad CNC data access but do not, by themselves, prove a generic Cycle Start API; this report does not infer one.

[FANUC Program Transfer Tool](https://www.fanucamerica.com/products/software/program-transfer-tool), [FASConnect](https://www.fanucamerica.com/products/software/fasconnect), [FANUC Data Server/DNC options](https://www.fanucamerica.com/support/cnc/options), [FOCAS2](https://www.fanucamerica.com/products/software/focas2-library), [FANUC PSIRT](https://www.fanuc.co.jp/en/product/vulnerability/policy.html)

### 7.4 HEIDENHAIN

HEIDENHAIN DNC explicitly supports remote Start, pause, stop, and machine-specific PLC functions. It is an automation/control interface requiring OEM and safety integration, not just file transfer.

StateMonitor is a monitoring and management product. Its use of DNC, OPC UA, or MTConnect underneath does not imply Start authority. HEIDENHAIN OPC UA uses certificates, can use user/password authentication, supports encrypted verified connections, and integrates with control user permissions.

With user management active, the documented secure path is SSH and unauthenticated serial/network LSV2 is disabled. Some OEM configurations can re-enable insecure legacy services, which is a deliberate downgrade. Backup/restore can cover folders or the whole TNC drive, can stop/restart NC software, and may reserve machine configuration to the builder.

[HEIDENHAIN DNC](https://www.heidenhain.com/products/software/heidenhain-dnc), [StateMonitor](https://www.heidenhain.com/products/software/pc-software-for-cnc-controls/statemonitor), [OPC UA NC Server](https://www.heidenhain.com/products/software/opc-ua-nc-server), [TNC 128 setup/user management](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC128/77184x-18/einrichten/1263174-21.pdf), [TNC 640 backup/restore](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-08/bhb/892903-26.pdf)

The public documentation does not provide a universal remote-start interlock matrix. Exact behavior remains machine-builder evidence.

### 7.5 Okuma

Okuma OSP-P500 material describes operator and communications authentication, user restrictions on operations, operation history, allowlisting, anomaly/falsification detection, and control data backup/restore.

Its named DNC functions separate Ethernet transfer, remote Ethernet download-for-machining, and remote buffering. Connect Plan is browser/mobile monitoring and history, not public proof of Cycle Start.

[Okuma OSP-P500](https://www.okuma.com/files/documents/OSP-P500-Brochure_ENGLISH_Mar2023.pdf), [Okuma Connect Plan](https://www.okuma.com/connect-plan)

### 7.6 Mazak

Mazak supplies three useful contrasts:

- SmartBox uses read-only MTConnect, per-machine network isolation, and screening intended to prevent parameter alteration.
- Smooth Link separates administrator/general permission levels and allows authorized remote program and tool-data rewriting.
- the Ethernet Operation Function can execute a large EIA/ISO program from a host while transferring it to the NC.

Monitoring, editing, and streaming execution are different trust planes. Any remote edit invalidates the artifact approval and interruption checkpoint. Host-streamed execution requires an explicit DNC recovery model.

[Mazak Smooth Link](https://virtual.mazakusa.com/wp-content/uploads/2020/08/Mazak_SMOOTH_Link_Flyer.pdf), [Mazak SmartBox cybersecurity](https://www.mazak.com/us-en/news-media/useful-information/blog/Cybersecurity-and-Data-Access-for-Profitability-Through-Digitized-Machine-Tools/), [SmartBox 2.0](https://www.mazak.com/us-en/news-media/news/mazak-advances-machine-connectivity-smart-box-2/), [Mazak Ethernet Operation Function](https://ezseries.mazakusa.com/machine/vc-ez-16-x/)

### 7.7 Cross-vendor conclusion

No responsible architecture should infer one capability from another:

| Known capability | Invalid inference |
| --- | --- |
| screen can be viewed | motion can be commanded |
| file can be uploaded | file can be selected |
| program can be selected | program can be started |
| program can be edited | edit is approved |
| user is authenticated | user may write PLC/offsets |
| VPN is connected | machine is ready |
| controller reports READY | remote local-presence requirement is satisfied |
| backup completed | restore is possible |
| update downloaded | update is authentic, compatible, or safe to install |

## 8. Public-source audit: FluidNC

Repository: [bdring/FluidNC at 94e8adbbc17fde3e29d025e4c91b8dbcf76109e3](https://github.com/bdring/FluidNC/tree/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3)

### 8.1 Confirmed network and authority behavior

FluidNC's Config.h leaves ENABLE_AUTHENTICATION commented out and warns that the current option is weak because credentials are stored and transmitted without a secure channel. In that default build, WebUIServer::is_authenticated returns administrator level.

[Config.h](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/Config.h), [WebUIServer.cpp](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WebUIServer.cpp)

The web server exposes command, file, WebSocket, WebDAV, upload, and firmware-update surfaces. Some HTTP handlers check guest/administrator level, but an unauthenticated default build is administrator and several command/file transports bypass those checks entirely. Firmware update checks administrator level, then uses the platform Update write/end path; no artifact-signature verification is visible in this application path.

Security meaning:

- the default web boundary is network reachability, not identity;
- any client that reaches the service inherits administrator authority;
- cleartext HTTP/WebSocket transport cannot protect credentials or commands;
- an administrator check is ineffective when anonymous means administrator;
- a firmware hash or manifest checksum would detect corruption but would not authenticate the publisher.

The independent source pass found several paths that bypass even the optional authentication mode:

- /cyclestart_reload is registered for HTTP_ANY and directly emits the Cycle Start event without an authentication, role, presence, or state check;
- /feedhold_reload and /restart_reload similarly emit Feed Hold and reset events;
- the WebSocket handshake copies a Session cookie but every connection becomes a command Channel and incoming frames enter it without an is_authenticated check or visible Origin gate;
- Telnet is enabled by default on port 23 and every accepted client is registered as a command Channel without login;
- WebDAV dispatch for /flash and /sd permits read/write/move/delete operations without consulting the login layer;
- /files and /upload write the upload body before the later request handler rejects guest level;
- the synchronous HTTP command path receives but does not enforce auth_level, while its worker executes the supplied settings line as administrator;
- ArduinoOTA starts whenever Wi-Fi is active without an application-level password/password-hash configuration before begin.

[Cycle Start route registration](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WebUIServer.cpp#L356-L370), [Cycle Start/Feed Hold/Reset handlers](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WebUIServer.cpp#L943-L964), [WebSocket handshake](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WebUIServer.cpp#L326-L338), [WebSocket command channel](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WSChannel.cpp#L202-L280), [Telnet server](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/TelnetServer.cpp#L22-L83), [WebDAV dispatch](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WebDAV.cpp#L344-L435), [upload ordering](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WebUIServer.cpp#L988-L1010), [late upload authorization](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WebUIServer.cpp#L1165-L1171), [HTTP command dispatch](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WebUIServer.cpp#L676-L754), [administrator worker](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/WebClient.cpp#L16-L31), [ArduinoOTA](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/WebUI/OTA.cpp#L15-L68)

The unauthenticated Cycle Start route is the highest-severity finding. Because it accepts HTTP_ANY, a reachable client can request resume/start without reading a response; ordinary browser cross-site request triggering may therefore matter even without permissive CORS. This is source-confirmed control flow, not a live-machine exploit test.

### 8.2 Useful command-arbitration behavior

Protocol.cpp maintains one activeChannel for line-oriented protocol processing. Once a channel supplies a line, it owns the acknowledgement path until that line resolves. This is a useful anti-interleaving mechanism and a strong lesson for sender architecture.

[Protocol.cpp](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/Protocol.cpp)

It is not an authorization boundary:

- it does not prove who owns the channel;
- real-time commands may have separate semantics;
- network clients may still compete between lines or jobs;
- the channel lock does not bind an immutable artifact, operator, lease epoch, or physical setup.

### 8.3 Optional authentication risks

When compiled, the optional implementation uses 1–16 character local passwords, cleartext transport/storage, default-style credentials in configuration, and a predictable Session construction derived from remote IP plus elapsed time. The compiled password expression rejects the valid ordinary-user branch because of its Boolean structure. That is a source-confirmed logic defect; runtime consequences were not exercised on hardware.

The broader conclusion does not depend on that login defect: direct command, file, and update paths sit outside or bypass the login boundary.

### 8.4 Secrets and backups

The HTTP command feature can persist bearer-token settings in local controller storage. Controller filesystem copies and backups can therefore contain network secrets as well as programs/configuration. Backup policy must inventory, encrypt, restrict, rotate, and redact secrets rather than treating the controller filesystem as public G-code.

## 9. Public-source audit: gSender

Repository: [Sienci-Labs/gsender at 43f841edf89bc346163af10f6b0087d56ca9fadb](https://github.com/Sienci-Labs/gsender/tree/43f841edf89bc346163af10f6b0087d56ca9fadb)

### 9.1 Source-confirmed authorization defects

The IP authorization function initializes pass to true next to a TODO to repair the whitelist. Every IP therefore passes this check.

[access-control.js](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server/access-control.js)

The Express server installs JWT middleware for API routes, but its UnauthorizedError handler contains commented validation and sets bypass to true. Unauthorized API requests are allowed through the error path.

[app.js](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server/app.js)

These are high-confidence source-confirmed defects at the pinned commit. They are not merely complaints about weak password policy.

### 9.2 Unauthenticated command surface

The Socket.IO CNC engine applies the always-passing IP check and does not install equivalent JWT authentication. Its handlers include:

- controller open, close, and reconnect;
- high-level command execution;
- raw write and writeln;
- firmware flash start;
- file and controller operations.

[CNCEngine.js](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server/services/cncengine/CNCEngine.js)

The REST surface includes G-code upload/download, stored command execution, users/settings, and machine/configuration functions. Upload can load arbitrary G-code into the connected control workflow. The same unauthenticated REST composition exposes host OS command execution: a client can create a stored command record, invoke its run route, and TaskRunner passes its text to defaultShell.spawn.

[gSender command routes](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server/app.js#L316-L322), [command creation](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server/api/api.commands.js#L111-L145), [command run](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server/api/api.commands.js#L236-L255), [shell spawn](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server/services/taskrunner/TaskRunner.js#L32-L46)

This is source-confirmed static reachability at the pinned commit. No command was executed against a live deployment.

### 9.3 Exposure

The standalone CLI defaults to 0.0.0.0 on port 8000, while Electron-local operation uses a narrower host. Headless settings can deliberately bind a LAN address. Global CORS middleware is enabled and no built-in TLS termination is visible.

[server-cli.js](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server-cli.js)

On a reachable headless/LAN deployment, the source paths combine into a serious control risk:

~~~text
network reachability
-> IP authorization always passes
-> JWT error is bypassed for REST
-> Socket.IO lacks JWT and inherits the IP pass
-> command/raw-write/firmware operations become reachable
~~~

Deployment firewalls can reduce exposure, but they do not repair the application authorization contract.

## 10. Public-source audit: cncjs

Repository: [cncjs/cncjs at fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1](https://github.com/cncjs/cncjs/tree/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1)

cncjs provides a useful comparison because the corresponding baseline is materially stronger:

- Express JWT validation is active;
- user validation is not commented out;
- Socket.IO uses socketio-jwt;
- IP authorization is actually evaluated.

[cncjs app.js](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/app.js), [cncjs CNCEngine.js](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/services/cncengine/CNCEngine.js)

Its trust assumptions still matter:

- standalone mode defaults to 0.0.0.0:8000;
- RFC1918, loopback, link-local, and local IPv6 ranges are allowlisted when general remote access is false;
- enabling allowRemoteAccess admits any source IP at this layer;
- when no users exist, sign-in can issue an anonymous JWT;
- the built-in server does not provide a complete TLS/PKI deployment boundary.

[cncjs access-control.js](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/access-control.js), [cncjs server-cli.js](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server-cli.js)

cncjs also exposes a general stored-command API. An authenticated client can create arbitrary command text and run it through defaultShell.spawn. Combining the confirmed defaults produces:

~~~text
ordinary RFC1918 LAN peer
-> accepted by IP policy
-> no configured users
-> anonymous JWT issued and accepted
-> authenticated CNC and stored-command APIs
-> controller authority plus host shell command execution
~~~

[anonymous sign-in](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/api/api.users.js#L67-L83), [anonymous user validation](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/access-control.js#L38-L53), [command routes](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/app.js#L276-L282), [command creation](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/api/api.commands.js#L88-L122), [command run](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/api/api.commands.js#L213-L232), [shell spawn](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/services/taskrunner/TaskRunner.js#L9-L23)

Thus cncjs authenticates much better than the pinned gSender fork, but its default composition still approximates “the private LAN is trusted” and “a server with no configured users permits anonymous onboarding.” That may be intentional convenience for a hobby sender; it is not a sufficient boundary for safety-critical remote Start or a host shell runner.

The browser message bridge contains a TODO around origin verification but also requires a Session token. This is a defense-in-depth concern rather than evidence of unauthenticated control.

## 11. Current KerfDesk trust-boundary audit

### 11.1 Present product boundary

KerfDesk is not currently a network CNC server. The live machine path is:

~~~text
trusted renderer
-> platform serial adapter
-> Web Serial / Electron serial permission
-> local USB serial controller
~~~

There is no general REST, WebSocket, OPC UA, MTConnect, DNC, or cloud Cycle Start service in this snapshot. This sharply reduces remote exposure compared with FluidNC's embedded web server or the gSender/cncjs headless servers.

The relevant network surfaces are:

- hosted PWA delivery;
- desktop update metadata and release artifacts, although auto-update is disabled;
- the loopback/private-network camera bridge;
- ordinary browser and Electron supply-chain dependencies.

That distinction must remain explicit. Adding remote monitoring would not, by itself, authorize adding remote command.

### 11.2 Electron renderer isolation

The Electron main process configures:

- contextIsolation true;
- nodeIntegration false;
- sandbox true;
- a custom app origin;
- Content Security Policy;
- navigation and new-window restrictions;
- permission check/request handlers;
- trusted renderer origins;
- device-selection policy.

These are strong desktop boundaries. They reduce the chance that renderer content can directly obtain Node or unrestricted OS authority. They do not make a compromised trusted renderer safe: the renderer intentionally owns machine-facing serial capability after permission is granted.

Relevant source:

- electron/main.ts
- electron/trusted-renderer-policy.ts and tests
- electron/serial-port-choice.ts and tests

### 11.3 Hosted-origin and Web Serial authority

Chrome's Web Serial contract requires a user gesture for requestPort. getPorts returns ports to which that origin already has access. [Chrome Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial)

KerfDesk's web adapter:

- calls requestPort for a user-mediated selection;
- calls getPorts to close stale paired handles before selection;
- calls port.forget on explicit disconnect where supported;
- deliberately preserves pairing on a cable-yank path.

This is sensible local UX, but it creates an important supply-chain boundary:

> JavaScript served later from the same trusted origin may be able to enumerate a previously granted controller port.

The current app still uses an explicit requestPort flow to connect, and the browser remains a permission boundary. Nevertheless, compromise of the hosting origin, deployment account, service worker, DNS/CDN path, or trusted application bundle belongs in the machine command threat model. Web delivery is not “just the UI” once the origin holds a controller grant.

Recommended controls are:

- immutable, reviewed deployment artifacts;
- protected production deployment identity;
- signed/attested build provenance;
- restrictive CSP and dependency governance;
- explicit visible controller connection state;
- permission revocation on deliberate disconnect;
- no third-party scripts in the machine-control origin;
- separate origins for marketing/content and machine control;
- a local physical interlock or controller mode that limits hazardous commands regardless of origin authority.

### 11.4 Camera bridge boundary

The camera bridge listens on loopback and proxies selected private-network RTSP/frame sources. It restricts destination forms and requires a trusted renderer origin. That is substantially better than a general open proxy.

The remaining high-value threat is a trusted-origin compromise:

~~~text
compromised hosted KerfDesk origin
-> allowed request to local loopback bridge
-> bridge reaches private-network camera address
-> private-network observation or request surface
~~~

This is a private-network proxy/SSRF and camera-credential concern, not currently a CNC command API. It should not be conflated with remote machine control. The same architectural lesson applies: “trusted web origin” is a powerful principal and must be protected like application code.

### 11.5 Desktop updater and release chain

electron/main.ts sets IS_DESKTOP_UPDATE_CHANNEL_TRUSTED to false. configureAutoUpdater therefore remains inert even in a packaged build. When enabled in the future, auto-update.ts configures background download and install-on-quit and deliberately never invokes quitAndInstall during the Session.

This is a good current fail-closed choice:

- an incomplete release trust chain cannot silently replace the machine-control application;
- the updater does not force a mid-job restart;
- a packaged application does not imply update trust.

The release pipeline is not yet ready to flip that flag:

- the Windows workflow is explicitly named and documented as unsigned by default;
- signing is optional behind CSC_LINK/CSC_KEY_PASSWORD;
- latest.yml, installer, and blockmap are uploaded to object storage;
- no required artifact attestation, signed release manifest, SBOM binding, or atomic metadata promotion is visible;
- the generic feed is configured under dl.kerfdesk.com.

Electron advises code-signing distributed applications; macOS automatic update requires signing. GitHub artifact attestations can bind an artifact to repository, workflow, commit, and build context, but attestations must be verified and do not prove that code is safe. [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing), [Electron updating](https://www.electronjs.org/docs/latest/tutorial/updates), [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)

Required before enabling:

1. OS code signing and protected signing identity.
2. A signed or otherwise cryptographically authenticated update manifest.
3. Build provenance/attestation verified by release policy.
4. SHA-256 digests for every artifact and manifest reference.
5. Atomic publication: immutable versioned artifacts first, latest pointer last.
6. Rollback/downgrade policy.
7. Compatibility declaration for project/checkpoint/controller protocols.
8. SBOM and dependency-vulnerability handling.
9. Update deferral during active, held, interrupted, or unresolved recovery state.
10. Safe rollback and recovery after power loss or corrupted download.
11. Pre/post-update validation of machine profile and controller compatibility.
12. An operator-visible release identity.

### 11.6 PWA update behavior

The PWA uses prompt-style service-worker update behavior. Its update prompt is gated away while a job is active, and the operator chooses Reload. Electron excludes this PWA registration path.

That is a useful runtime safety control. It does not authenticate the deployed web artifact or solve rollback. An active job can also end in an interrupted/resumable state; the update policy should consider unresolved recovery evidence, not only a currently streaming flag.

### 11.7 Project-file integrity

The .lf2 project format is deterministic JSON with strong shape, finite-number, resource, layer, machine-profile, and scene validation. Deserialization rejects malformed or nonfinite values that could otherwise reach G-code. These are valuable integrity and robustness controls.

The format does not currently bind:

- author or approving operator;
- source device;
- creation tool/build;
- project digest;
- embedded-resource digest manifest;
- machine-kit revision;
- approval signature;
- intended controller identity;
- immutable setup/tool/fixture snapshot.

Structural validity is not provenance. A well-formed malicious or accidentally modified project can pass schema validation.

### 11.8 G-code provenance

Exported G-code can include comment metadata for:

- application/version;
- commit SHA;
- build time;
- emitter revision;
- controller assumptions such as GRBL power/RPM mapping and laser/router mode;
- selected safety notes.

This is excellent diagnostic context. It is descriptive rather than cryptographic. Comments can be edited, copied, or stripped and do not bind the body.

A production job package needs:

~~~text
SHA-256 of exact canonical G-code bytes
source project digest
application, compiler, emitter, and post identity
controller dialect and target machine identity
machine profile/configuration revision
tool table and selected tool revision
work offset and setup/fixture identity
material/stock identity where required
approval identity and timestamp
compatibility constraints
optional detached digital signature
~~~

Start currently compiles directly from the live project and does not execute an immutable signed job package. External G-code opening is preview-only, which is a strong boundary: untrusted external program text is not silently promoted to executable machine control.

### 11.9 Checkpoint integrity

Job checkpoints store:

- an FNV-1a 32-bit fingerprint;
- character and line counts;
- acknowledged sendable-line count;
- machine kind;
- output scope;
- resolved origin/placement;
- resume-in-flight state;
- timestamps.

This is useful accidental-change detection. It is not adversarial integrity:

- FNV-1a is not collision resistant;
- localStorage is writable by scripts in the origin;
- character/line counts do not repair that;
- no signature or keyed authenticator binds the checkpoint;
- no exact job bytes or SHA-256 digest is retained;
- no controller firmware/configuration epoch is bound;
- no tool, fixture, stock, WCS, or workholding revision is bound;
- no reset/power-cycle epoch is bound;
- no actor, device, or approval identity is bound;
- acknowledged lines mean parsed/accepted into a communication window, not physically completed cuts.

The source comments correctly acknowledge the accepted-versus-executed distinction. The recovery architecture nevertheless maps acknowledged-line progress back into a raw source line and builds a new re-entry program. That can be useful only under a much stronger physical recovery contract.

### 11.10 Confirmed interrupted-router sequence hazard

The current source reproduces the user's motivating problem.

src/core/controllers/grbl/resume-program.ts constructs a CNC resume preamble in this order:

~~~text
restore spindle command M3/M4 with S
spin-up dwell
G0 retract to configured safe Z
G0 travel to recorded XY
G1 descend to recorded Z
restore feed
replay tail
~~~

The source comment says the spindle starts before movement so the bit is at speed before the later plunge. That reasoning silently assumes the spindle can start safely at the interruption depth.

If the cutter stopped while embedded or mechanically bound, the first physical action is a stationary spindle start under load. That can:

- stall or trip the spindle;
- loosen or pull the tool;
- burn material;
- break the cutter;
- rotate or damage the workpiece;
- create an unexpected torque reaction;
- leave the application uncertain whether the later retract occurred.

Simply swapping the first two commands is not a universal repair. A blind rapid retract with a stationary cutter may also snap a flute, lift the part, gouge a wall, violate a ramp path, or be impossible after a plunge/drill/thread/tap operation. The correct architecture classifies the interruption and chooses a validated escape.

This is a **source-confirmed safety defect in the generic resume model**, not merely a cybersecurity concern. Security makes it worse when a remote client can trigger the unsafe sequence without an operator seeing the tool.

Required decision tree:

~~~text
Was the cutter proved clear of material?
  yes -> safe positioning policy may proceed
  no/unknown -> block automatic resume

If engaged, what process was active?
  router contour/pocket
  ramp/helix
  drilling/peck
  rigid tap/thread
  probe
  rotary/indexed operation
  laser/plasma/other

Is there an OEM/process-approved escape?
  yes -> require local inspection/consent and execute that bounded routine
  no -> abort automatic recovery and require manual recovery

After clearance:
  verify tool, workholding, WCS, limits, controller epoch
  command spindle in correct direction
  prove at-speed where hardware permits
  approach outside material
  re-enter along a validated path at controlled feed
  establish a new recovery epoch
~~~

The recovery UI currently says the machine will restart the spindle, move at safe height, feed back to depth, and replay. It should not imply this is safe for every interruption.

### 11.11 Autosave and local persistence

Autosave writes project JSON to localStorage. Checkpoints, device/setup preferences, camera URLs, and other state also use origin-local persistence.

This is convenient crash recovery, not a trusted journal:

- it is mutable by same-origin code;
- quota eviction and user clearing can remove it;
- records are not append-only;
- there is no durable cross-device identity;
- timestamps depend on the local clock;
- it cannot prove what physically happened.

Local persistence should remain a UX aid. Safety-relevant recovery evidence needs a durable controller/cell-side record with cryptographic identity and monotonic epochs.

### 11.12 Logs and forensics

The serial transcript is capped at 500 entries and the general log at 200. They are memory-resident and can be cleared. The UI can copy visible transcript data, but there is no durable append-only command journal, hash chain, central export, or retained job record.

This is sufficient for live diagnostics, not incident reconstruction. After a long raster or a restart, the evidence required to answer “which exact bytes were sent, acknowledged, executed, interrupted, or retried?” may be gone.

A future audit trail must not overload the real-time sender. Use an asynchronous bounded local spool plus external durable storage, with explicit gap records when the collector is unavailable.

### 11.13 Command arbitration

KerfDesk has strong application-level gates:

- an active streamer blocks conflicting setup, jog, home, settings, console, and machine operations;
- writes funnel through the laser store and transport;
- controller and motion operations have explicit active state;
- Stop/Pause and recovery paths are separated.

That is a good single-application baseline. It is not yet a multi-client authority model:

- no principal identity;
- no role/capability grants;
- no fenced execution lease;
- no command ID/idempotency ledger;
- no server-side state version;
- no local-versus-remote mode;
- no durable ownership transfer.

Remote control must be added behind a controller/cell command arbiter rather than by exposing the existing store over a WebSocket.

## 12. Required reference architecture

### 12.1 Separation of planes

~~~text
                           ENTERPRISE / CLOUD
                   planning, analytics, fleet views
                                |
                     authenticated outbound data
                                v
        +------------------------------------------------+
        |                    OT DMZ                      |
        | telemetry relay | audit sink | update staging |
        | jump host       | artifact registry           |
        +------------------------------------------------+
              ^ read-only             | guarded request
              |                       v
        +------------------------------------------------+
        |             CELL SUPERVISORY ZONE              |
        | command broker | job verifier | local HMI      |
        | MTConnect agent | engineering station          |
        +------------------------------------------------+
              ^ state                 | native guarded API
              |                       v
        +------------------------------------------------+
        |               CNC / PLC CONTROLLER             |
        | authoritative state | sequencer | program store|
        +------------------------------------------------+
              | safety permissives     | drive commands
              v                        v
        +----------------+       +-----------------------+
        | SAFETY SYSTEM  |       | FIELD / PHYSICAL CELL |
        | independent    |       | axes spindle tooling  |
        +----------------+       +-----------------------+
~~~

No enterprise browser directly addresses controller, PLC, safety PLC, drive, or field device.

### 12.2 Telemetry path

The telemetry path should be controller/agent initiated or outbound where feasible:

~~~text
controller -> read-only adapter -> cell historian/relay -> DMZ -> clients
~~~

It carries:

- source timestamp and monotonic sequence;
- source/controller identity;
- instance/reset epoch;
- quality/availability;
- bounded freshness;
- no reusable command credential.

Loss of telemetry does not issue control commands. It changes UI state to unknown/stale and blocks remote hazardous requests.

### 12.3 Command path

The command path should be a request/decision protocol:

~~~text
client intent
-> authenticate user and client
-> authorize exact capability/machine
-> require current local mode/consent
-> acquire fenced single-writer lease
-> verify immutable job/config identity
-> submit idempotent request with expected state version
-> controller rechecks physical and safety permissives
-> controller executes one validated transition
-> durable result and audit correlation
~~~

The client never sequences spindle, door, clamp, coolant, and motion as independent remote writes.

### 12.4 Local-presence modes

A useful mode model is:

| Mode | Remote authority |
| --- | --- |
| Local manual | Observe only; local pendant/HMI owns motion |
| Local armed | Named remote Session may request a bounded operation after fresh local consent |
| Remote maintenance | Time-limited engineering access; hazardous execution disabled unless separately enabled |
| Automated cell | Cell controller owns a commissioned execution lease under safety PLC/interlocks |
| Recovery required | Observe and diagnostic operations only; no Start |
| Security isolation | Remote conduits disconnected; local safe stop remains available |

Remote Cycle Start should default to prohibited. An engineered unattended cell is not an exception by checkbox; it is a separately commissioned system with safety PLC, guarding, workholding proof, automation state, risk assessment, and recovery procedures.

### 12.5 Fenced execution lease

At most one normal command principal owns execution:

~~~text
leaseId
machineId
owner principal and client
capability set
issuedAt / expiresAt
monotonic fencingToken
localEnableGeneration
controllerEpoch
jobDigest
~~~

Every hazardous request carries the latest fencing token. After expiry, revocation, reset, or ownership change, old tokens fail even if delayed messages arrive.

Safety Stop/E-stop and controller fault paths may preempt the lease. Preemption never transfers normal command ownership automatically.

### 12.6 Idempotent command envelope

~~~text
commandId
machineId
requestedTransition
expectedStateVersion
controllerEpoch
fencingToken
jobPackageDigest
principalId / role / clientId
localEnableGeneration
issuedAt / expiresAt
parameters with units and limits
reason / approval reference
~~~

The controller or trusted cell broker persists:

~~~text
RECEIVED
REJECTED
ACCEPTED
IN_PROGRESS
COMPLETED
ABORTED
OUTCOME_UNKNOWN
~~~

Replaying a commandId returns the durable prior state. It never repeats physical action.

### 12.7 Controller-side state version

Any fact relevant to authorization increments or invalidates a state version:

- reset/power-cycle;
- program select/edit;
- firmware/config/parameter change;
- tool/offset/WCS change;
- clamp/fixture/part-state change;
- mode/local-enable change;
- safety trip;
- lease change;
- interruption/recovery transition.

A request with an older expectedStateVersion is rejected. The controller still reevaluates live safety permissives immediately before action.

## 13. Immutable job-package architecture

### 13.1 Package contents

~~~text
manifest version
job/package ID
SHA-256 digest of exact controller program bytes
canonicalization rule and byte length
source project digest
source artwork/resource digests
CAM/compiler/emitter/post identifiers and configurations
controller dialect and required features
target machine/profile identity
firmware/configuration compatibility
units, coordinate/frame/origin assumptions
tool IDs, geometry, wear/tool-table revision
work offsets and probing/calibration revision
fixture/workholding/material/stock identity
safety-zone and setup revision
estimated envelope and resource requirements
approving identities and timestamps
detached signature / certificate chain
~~~

The exact signed object must be defined. Signing a mutable ZIP without canonical rules can create ambiguity. Prefer a canonical manifest whose entries carry digests of immutable payloads.

### 13.2 Artifact lifecycle

~~~text
created digest
-> validated digest
-> approved digest
-> transferred digest/receipt
-> controller-staged digest
-> selected digest
-> activated digest
-> started digest
-> completed/aborted digest
~~~

Any edit creates a new digest and invalidates downstream approval, activation, and checkpoint state.

### 13.3 Two-phase DNC transfer

Phase 1: stage

1. Negotiate target machine/controller identity and capacity.
2. Upload to a temporary non-executable object.
3. Record byte length and transfer receipt.
4. Read back or request controller-side digest.
5. Parse/validate with the target dialect where supported.
6. Verify job signature, compatibility, tools, and setup.

Phase 2: activate

1. Atomically bind an immutable digest to an activation ID.
2. Prevent edits to the active object.
3. Select by activation ID/digest, not mutable filename.
4. Recheck local mode and physical readiness.
5. Start only through the guarded command transition.

Incomplete uploads can never appear in the active namespace.

### 13.4 Network share and path identity

A share path is not stable identity. Record:

- server certificate or host identity;
- canonical share and object ID;
- file digest and byte length;
- version/generation/ETag where available;
- credential identity;
- mount Session;
- transfer timestamp and receipt.

If a share remounts, DNS changes, server identity differs, or file metadata changes, the prior approval is invalid.

### 13.5 DNC streaming progress

Track separate cursors:

~~~text
bytes read from source
bytes sent to transport
controller bytes/blocks acknowledged
controller blocks parsed
planner occupancy and accepted horizon
currently executing block if exposed
physical commit milestones
~~~

None may be substituted for another. A generic host cannot usually prove the exact physical cut point from serial acknowledgements alone.

Safe restart therefore uses a process-specific recovery fence and physical evidence, not “resume at last sent line.”

## 14. Interruption and recovery architecture

### 14.1 Separate execution states

~~~text
DISCONNECTED
UNTRUSTED
SAFE_STOPPED
LOCAL_ARMED
READY
STARTING
RUNNING
HOLDING
HELD
INTERRUPTED
OUTCOME_UNKNOWN
RECOVERY_REQUIRED
RECOVERING
~~~

The UI renders these states; it does not own them. OUTCOME_UNKNOWN is essential: a request may have reached the controller even when the client saw a timeout.

START and RESUME are different transitions. RESUME is not START with a different source-line pointer.

### 14.2 Physical engagement state

~~~text
UNKNOWN
CLEAR
APPROACHING
CONTACTING
CUTTING_ENGAGED
DRILL_ENGAGED
THREAD_OR_TAP_ENGAGED
PROBE_CONTACT
TOOLCHANGER_ENGAGED
WORKHOLDING_TRANSITION
PROCESS_SPECIFIC
~~~

Many controllers cannot infer all of this from native status. The recovery procedure may need:

- controller state and alarms;
- actual axis/spindle feedback;
- tool-load/spindle-load evidence;
- an operator inspection;
- camera evidence, never as the sole safety channel;
- machine-builder sensors;
- process knowledge from the active operation;
- a conservative UNKNOWN classification.

UNKNOWN blocks automatic resume.

### 14.3 Recovery checkpoint contract

A robust checkpoint binds:

~~~text
checkpoint ID and version
exact job/package digest
controller-accepted digest
controller/machine/firmware/configuration identity
controller reset/power epoch
command lease and command IDs
program, call stack, interpreter/modal state where trustworthy
sent, acknowledged, planned, executing, and physical-commit cursors
actual axes and validity/reference state
work and machine coordinate frames
tool identity, geometry/wear, compensation, and tool-table revision
spindle command, actual state, direction, and at-speed evidence
coolant/air/dust/extraction and auxiliary state
fixture, clamps, vacuum, stock, and part-state evidence
active operation/process and material-engagement classification
safety mode, local-enable generation, guard and permissive state
interruption cause and alarm/reset history
operator/approver/device identity
monotonic sequence plus trusted UTC correlation
recovery procedure ID/version and permitted fences
tamper-evident authenticator/signature
~~~

The checkpoint is invalidated by any material change or uncertainty, including reset, rehome requirement, tool change, WCS edit, fixture movement, stock movement, program edit, firmware/config change, local manual motion, safety intervention, lost source sequence, or an unresolved previous command.

### 14.4 Recovery transaction

1. Stop and preserve evidence; do not immediately reset away the fault.
2. Revoke ordinary remote command ownership.
3. Record controller, safety, network, and application epochs.
4. Determine whether prior commands have known or unknown outcomes.
5. Read authoritative actual positions, modes, spindle, alarms, and workholding.
6. Classify material/tool engagement.
7. Require local inspection for unknown or process-specific state.
8. Select a machine/OEM/process-approved recovery procedure.
9. Move only through a proved recovery envelope.
10. Re-establish position/reference, tool, offsets, setup, and job identity.
11. Move to a stable recovery fence outside irreversible transitions.
12. Reconstruct controller/modal state through a validated preamble or controller facility.
13. Prove spindle/coolant/auxiliary state in the correct machine-specific order.
14. Re-enter material on a validated lead-in/ramp/air-cut strategy, not at the interrupted source line by default.
15. Start a new controller, command, lease, checkpoint, and audit epoch.
16. Mark the old checkpoint consumed; never permit a second replay.

### 14.5 Recovery fences

Good router recovery fences may include:

- tool clear above a verified safe plane;
- machine referenced and actual position valid;
- correct tool and work offset verified;
- spindle stopped before a locally supervised clearance routine;
- spindle at speed before a later cutting lead-in;
- an intact, known workpiece with a safe external re-entry path.

Bad fences include:

- between clamp command and clamp proof;
- while cutter engagement is unknown;
- during a plunge, drilling cycle, thread, tap, probe, tool change, or workholding transition;
- immediately after a network timeout with unresolved outcome;
- after controller reset without restored position/modal/config evidence;
- at the first unacknowledged source line;
- at a line whose preceding block is still in the planner;
- after a remote program/offset/tool edit;
- at a point accessible only by cutting through already-machined or unknown material.

### 14.6 Physical commit milestones

For some operations the useful restart unit is not a line but an application-defined milestone:

~~~text
setup verified
tool measured
roughing region completed
pocket depth layer completed
contour lead-out completed
hole completed and tool clear
probing result committed
tool change completed and proved
part transfer committed
workholding transition committed
~~~

Milestones require controller/process evidence. They should be designed into the CAM/execution plan rather than inferred after a crash.

## 15. Update and firmware trust

### 15.1 Protect, detect, recover

NIST SP 800-193 frames firmware resilience as Protect, Detect, and Recover: authenticate and integrity-protect changes, detect corruption, and restore a protected known-good state. [NIST SP 800-193](https://csrc.nist.gov/pubs/sp/800/193/final)

For CNC:

- Protect the signing identity and update authorization.
- Detect wrong target, tampering, rollback, partial install, configuration incompatibility, and unexpected post-update behavior.
- Recover through A/B images, recovery media, or a documented offline service path.

A valid user login is not firmware authenticity. CISA has documented OT products where an authenticated authorized user could install unsigned firmware. [CISA ICSA-25-023-02](https://www.cisa.gov/news-events/ics-advisories/icsa-25-023-02)

### 15.2 Signed release bundle

~~~text
release manifest
  product and target identities
  version and monotonic security epoch
  artifact SHA-256 digests and lengths
  compatibility matrix
  migration/rollback constraints
  SBOM digest
  build provenance reference
  signing certificate/key ID
  detached signature

installer/application artifacts
firmware/controller artifacts
migration scripts
recovery artifact
release notes and known safety impacts
~~~

The updater verifies the manifest signature before trusting artifact URLs or hashes. Artifact digests verify exact bytes. OS code signing verifies publisher identity at installation/runtime. Build attestations link artifacts to the expected source and workflow. These controls complement rather than replace each other.

### 15.3 Safe update state

Update is blocked when:

- a job is running, holding, or settling;
- an interruption checkpoint is unresolved;
- a remote command outcome is unknown;
- axes/spindle/tool changer/workholding are active;
- the machine is not in the OEM-required maintenance state;
- reliable power or rollback is unavailable;
- the update target or compatibility cannot be proved;
- required backups and recovery media are unverified.

Download may happen in a low-priority isolated path if it cannot affect real-time control. Installation is an explicit machine-state transition.

### 15.4 Secure development

NIST SP 800-218 recommends protecting source and releases, least privilege and accountability, integrity hashes/signatures, managed signing certificates, archived provenance, and SBOM data. [NIST SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final)

For KerfDesk this means:

- protected main/release branches;
- pinned and reviewed build actions;
- least-privilege workflow tokens;
- reproducible or at least deterministic build inputs;
- mandatory tests and review for machine-control changes;
- separated signing/publishing authority;
- immutable release artifacts;
- provenance verification before promotion;
- dependency and secret scanning;
- a vulnerability-response and key-rotation plan.

## 16. Backup and restore

### 16.1 Backup inventory

A complete machine recovery set can include:

- CNC/PLC logic and data;
- HMI and cell-controller configuration;
- controller firmware and option compatibility;
- drive, spindle, servo, safety, and I/O parameters;
- work and tool offsets;
- macros, variables, compensation, calibration;
- machine programs and subprograms;
- users, roles, certificates, network configuration, and secrets;
- robot, feeder, changer, probe, camera, and peripheral setup;
- machine electrical/network drawings;
- OEM tools, cables, licenses, dongles, and recovery media;
- exact compatible PCs/VMs and operating environments;
- machine serial/options and spare hardware.

NIST SP 1339 recommends risk-based frequency and restore order, redundant onsite/offsite copies, hashing, encryption, write-once protection, and recurring restoration exercises. [NIST SP 1339 OT Backup Quick Start Guide](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1339.pdf)

### 16.2 Restore is a hazardous configuration change

Restore must:

1. Authenticate the archive and operator.
2. Verify machine serial, control family, firmware, options, and dependencies.
3. Decrypt only in a protected environment.
4. Inventory every object that would be added, removed, or overwritten.
5. Show PLC, parameter, offset, compensation, network, user, certificate, and security changes.
6. Preserve pre-restore evidence and a rollback image.
7. Require the OEM-defined safe maintenance state.
8. Apply in dependency order.
9. revalidate safety, I/O, homing/reference, compensation, limits, and tooling.
10. Compare restored state against the approved baseline.
11. run a controlled proveout before production.

A backup that has never been restored with the actual engineering tools, licenses, cables, and spares is only a hopeful copy.

### 16.3 Backup confidentiality

Because archives may contain credentials, private keys, topology, programs, customer geometry, and proprietary PLC logic:

- encrypt at rest and in transit;
- restrict backup and restore separately;
- use unique machine/archive identity;
- redact or rotate secrets after exposure;
- record every read/export;
- prevent a general operator from downloading full controller archives;
- retain offline or write-once copies resistant to ransomware.

## 17. Durable audit and forensic model

### 17.1 Audit record

Each security- or safety-relevant operation records:

~~~text
event ID and correlation/command ID
principal, role, client/device, certificate/session
machine/controller/cell identity
lease and fencing token
requested capability and parameters
job package digest and activation ID
expected and observed state version/epoch
local consent and mode generation
precondition/permissive snapshot with freshness
native request and normalized response
accepted, started, completed, rejected, aborted, or unknown outcome
old/new controller state
source/controller timestamps plus collector monotonic order
network/source address and conduit
approval/ticket/reason
software/firmware/configuration versions
gap, reboot, clock-change, and collector-outage markers
~~~

### 17.2 Correlation

The client, command broker, controller, PLC gateway, and audit collector share a correlation ID. OPC UA client and server audit IDs can be linked. DNC transfer receipt, activation, Start, and completion all reference the same immutable digest.

### 17.3 Tamper evidence and availability

The controller-local log is a spool, not the sole record:

- bounded async queue protects real-time work;
- signed/hash-chained segments make deletion/reordering visible;
- central append-only/WORM retention preserves evidence;
- gaps are explicit events rather than silently hidden;
- clocks are synchronized but monotonic local order remains available;
- local log deletion and controller reboot do not erase central history;
- audit flooding is rate-limited without dropping critical safety events;
- sensitive program/credential data is redacted or access-controlled.

Logging must not exhaust CPU, storage, planner timing, or network capacity.

## 18. Concrete domain model

### 18.1 Security principal

~~~text
Principal
  principalId
  human/service/device type
  authentication methods
  certificate/key identity
  roles and machine-scoped grants
  validFrom / expiresAt
  revocationVersion
  assurance and local-presence state
~~~

### 18.2 Machine security context

~~~text
MachineSecurityContext
  machineId / controllerId / cellId
  networkZone
  controllerEpoch
  stateVersion
  localMode
  localEnableGeneration
  safetyState
  telemetryFreshness
  activeLease
  activeJobActivation
  unresolvedCommands[]
  recoveryState
  firmware/configuration identity
~~~

### 18.3 Job activation

~~~text
JobActivation
  activationId
  packageDigest
  controllerAcceptedDigest
  target machine/profile
  stagedAt / activatedAt / expiresAt
  tool/setup/offset revisions
  approvedBy[]
  immutable controller object
  compatibility verdict
  status
~~~

### 18.4 Command result

~~~text
CommandResult
  commandId
  transition
  requestDigest
  receivedAt
  acceptedAt
  startedAt
  completedAt
  stateBefore / stateAfter
  nativeControllerResult
  physicalEvidence
  outcome
  rejection/fault reason
~~~

### 18.5 Recovery evidence

~~~text
RecoveryEvidence
  interruptionId
  checkpointDigest
  controllerEpoch
  physical engagement classification
  inspection identity/time
  actual pose and validity
  spindle/tool/workholding/setup evidence
  chosen procedure ID/version
  approved recovery fence
  consumedAt
~~~

## 19. Safety and security invariants

These should become static checks, unit/property tests, integration assertions, runtime guards, and hardware-in-the-loop evidence.

### Identity and authority

1. No hazardous operation is authorized by network location alone.
2. No shared/default credential may own motion authority.
3. Observation, transfer, activation, Start, jog, configuration, PLC, update, backup, and restore are separate capabilities.
4. An Observer can never Write, Call a command Method, upload, or Start.
5. An ordinary Operator cannot alter firmware, certificates, safety logic, PLC, or security policy.
6. Authentication success never satisfies physical readiness.
7. Remote authority expires automatically and is revocable immediately.
8. Browser close, reboot, or network disconnect is not assumed to revoke a server Session.
9. Local mode and local-enable generation are rechecked at execution time.
10. Remote Cycle Start requires fresh local consent unless the machine is a separately commissioned automated cell.

### Command ownership and protocol

11. Exactly one fenced normal execution lease exists per machine.
12. A newer fencing token invalidates every delayed request from an older owner.
13. Safety-stop paths can preempt but cannot silently transfer normal ownership.
14. Every hazardous request has a unique idempotent command ID.
15. A repeated command ID never repeats physical action.
16. A response timeout produces OUTCOME_UNKNOWN until authoritative reconciliation.
17. A stale expected state version is rejected.
18. The controller reevaluates safety and physical permissives immediately before action.
19. Safety-critical sequences are one guarded controller transition, not independent client Writes.
20. Partial batch success can never leave an unmonitored hazardous intermediate state.
21. Command and telemetry credentials are not interchangeable.
22. A console, macro, pendant, API, and streamer cannot interleave normal commands outside the arbiter.

### Program and setup integrity

23. A filename, program name, share path, or UI label is never job identity.
24. Exact controller-accepted bytes match the activated SHA-256 digest.
25. Incomplete or quarantined transfers cannot be selected or executed.
26. Any edit creates a new digest and invalidates activation, approval, and checkpoint.
27. Activation binds machine, dialect, firmware/configuration, tool, offsets, and setup revisions.
28. A remounted share or changed server identity invalidates transfer approval.
29. Export metadata comments are never treated as a signature.
30. A structurally valid project is not assumed approved or authentic.
31. External preview/import remains non-executable until it passes the full job-package workflow.
32. Tool/WCS/fixture/workholding changes invalidate recovery even when G-code bytes are unchanged.

### Start and physical state

33. READY telemetry does not authorize Start.
34. A live heartbeat does not prove a live or fresh controller source.
35. Start is blocked on unknown guard, E-stop, mode, position, tool, offset, clamp, workholding, spindle, or job state.
36. Start sequence is machine/process-specific and controller-owned.
37. Spindle command accepted is not spindle at-speed.
38. Axis command accepted is not physical motion complete.
39. Local E-stop and safe stop remain available through all network/identity/cloud failures.
40. No general remote client directly commands a safety PLC or field drive.

### Recovery

41. START and RESUME are distinct authorized transitions.
42. Last sent/acknowledged line is never equated with last physical cut.
43. Unknown cutter/material engagement blocks generic automatic resume.
44. A stationary spindle is not started with an embedded cutter unless an explicit OEM/process recovery procedure requires and permits it.
45. A blind retract is not issued from unknown engagement.
46. After proved clearance, spindle direction and at-speed are established before cutting re-entry where the process requires them.
47. Re-entry uses a validated lead-in/ramp/air-cut path rather than blind descent to the interrupted point.
48. Controller reset, rehome, manual motion, safety intervention, or outcome-unknown invalidates the old checkpoint unless explicitly reconciled.
49. A checkpoint is cryptographically bound to job, machine, configuration, setup, actor, and recovery epoch.
50. A checkpoint is single-use; recovery creates a new epoch.
51. Threading, tapping, probing, toolchange, workholding transition, and other phase-coupled operations use process-specific recovery.
52. Recovery never relies solely on camera or application-local storage.

### Network and telemetry

53. Enterprise hosts have no direct route to controller, PLC, safety, or field devices.
54. Every conduit is purpose-specific and default deny in both directions.
55. MTConnect remains read-only and side-effect-free.
56. MTConnect instance changes, sequence gaps, staleness, or UNAVAILABLE invalidate derived readiness.
57. SecurityPolicy None is disabled for command-capable OPC UA endpoints.
58. Untrusted, expired, revoked, wrong-URI, or invalid-signature certificates are rejected.
59. Remote maintenance uses least privilege, expiry, monitoring, and rapid local disconnect.
60. A VPN is never the sole authorization or safety boundary.

### Update, backup, and audit

61. Unsigned or wrong-target firmware/release artifacts are rejected.
62. Hash verification without authenticated provenance is not sufficient publisher trust.
63. Updates cannot install during active or unresolved machine/recovery state.
64. Power loss during update recovers only to an authenticated compatible image.
65. Rollback cannot cross a prohibited security/configuration epoch.
66. Backups are encrypted, machine-bound, integrity-protected, and access-controlled.
67. Restore is blocked until compatibility and change inventory are reviewed.
68. Restore success requires a recurring practical drill and post-restore validation.
69. Critical audit evidence survives controller/app reboot and local log deletion.
70. Audit collection cannot starve real-time control or safety functions.
71. Every missing interval, overflow, clock jump, and collector outage is visible.
72. Secrets are not exposed in routine logs, projects, exported G-code, or unprotected backups.

## 20. Failure-scenario catalogue

### Network and identity

1. A new device joins the private LAN and is implicitly trusted.
2. A browser cross-site request reaches an unauthenticated Cycle Start route.
3. A leaked bearer token survives longer than the operator Session.
4. A remote-support Session persists after browser close or controller reboot.
5. A reverse proxy header changes IP allowlist classification.
6. A VPN drops after Start reaches the controller but before the reply returns.
7. Two authorized clients believe they own the machine.
8. A delayed packet from the prior owner arrives after lease transfer.
9. Identity-provider outage blocks ordinary IT access but must not block E-stop.
10. A compromised monitoring account is accidentally accepted by the command API.
11. A vendor laptop bridges enterprise Wi-Fi and the controller cell.
12. An expired maintenance path remains physically connected.

### Program transfer and DNC

13. A share file changes after validation but before controller read.
14. A share remount points the same path at a different server.
15. An upload is interrupted but the partial file appears selectable.
16. Controller text conversion changes the accepted bytes after host hashing.
17. A program is edited remotely during Feed Hold.
18. The same filename is replaced with a different program.
19. Host reconnect resumes from last byte sent and duplicates a controller block.
20. Controller reset clears its buffer while host progress remains advanced.
21. Network retry submits a second Cycle Start.
22. DNC disconnect occurs after an irreversible physical action but before acknowledgement.
23. A macro/subprogram dependency changes while the top-level digest stays constant.
24. Tool/offset data changes while exact G-code bytes stay constant.

### Command semantics

25. A multi-node OPC UA Write partially changes spindle/door/motion state.
26. A Method completes after the Session and response disappear.
27. Good_CompletesAsynchronously is misread as physical completion.
28. A client retries a clamp, toolchange, or program-select operation blindly.
29. A second socket sends raw serial during an active job.
30. A real-time character bypasses ordinary line arbitration.
31. A reset destroys modal/interpreter evidence but UI still offers Resume.
32. A telemetry READY sample is combined with a stale guard sample.

### Physical interruption

33. Power fails with cutter embedded.
34. Feed Hold occurs while the planner contains future moves.
35. Spindle stalls but acknowledged G-code continues ahead.
36. A blind M3 starts an embedded bit.
37. A blind G0 retract snaps a trapped tool or lifts the work.
38. A resume descends at a generic plunge feed into unremoved stock.
39. The recorded XY is inside material because the interrupted path was a ramp.
40. The workpiece or fixture moved after interruption.
41. Work zero was re-established differently.
42. The tool was replaced with a different stickout.
43. Machine lost reference and software position looks plausible.
44. A drilling, tapping, probing, or toolchange phase is replayed from its textual middle.
45. The first unacknowledged line was already physically underway.
46. A completed line's physical effect was later reversed by fault or slip.

### Telemetry and logging

47. MTConnect Agent restarts and sequence numbers restart under a new instance.
48. FIFO overflow removes the events needed for reconstruction.
49. Agent stays reachable while controller source becomes unavailable.
50. Clock jumps backward or forward.
51. Controller-local event ring wraps before collection.
52. Reboot erases local logs while privilege persists.
53. Audit collector outage creates an unmarked gap.
54. Log flood delays controller or sender timing.
55. Sensitive tokens or programs enter diagnostic exports.

### Update and restore

56. Validly hashed artifact came from an attacker-controlled manifest.
57. Validly signed artifact targets the wrong controller option.
58. Object-store latest metadata is published before all artifacts.
59. Power fails between application and firmware migration steps.
60. Downgrade reintroduces a revoked trust key or incompatible project format.
61. Restore overwrites PLC, offsets, compensation, users, or network state unexpectedly.
62. Backup is corrupt, encrypted with a lost key, or requires an unavailable license/dongle.
63. Restore succeeds syntactically but machine I/O mapping differs.
64. Update/download traffic exhausts a low-resource controller.

### Hosted application and local bridges

65. Production web deployment is compromised after Web Serial permission was granted.
66. A stale service worker serves an unapproved sender build.
67. A compromised trusted origin uses the camera bridge to reach a private camera.
68. A third-party script gains same-origin access to machine controls.
69. Explicit disconnect forgets one port but another stale grant remains.
70. Desktop update channel is enabled before signing/provenance enforcement.

## 21. Verification strategy

### 21.1 Static and configuration checks

- Generate a zone/conduit diagram from deployed configuration and compare to firewall truth.
- Prove no enterprise route reaches controller, PLC, safety, or field addresses.
- Enumerate every listening port, protocol, identity store, and default credential.
- Map every API route/Method/event to an operation-specific capability.
- Reject wildcard CORS, general bind addresses, anonymous tokens, and private-LAN trust in hardened mode.
- Verify TLS/OPC UA policy, certificate validation, revocation, and expiry.
- Verify no command-capable endpoint offers SecurityPolicy None.
- Verify release/update signature, digest, compatibility, and rollback policy.
- Verify job canonicalization and digest rules are unambiguous.
- Verify all recovery operations have explicit supported process/machine scope.
- Verify logs and backups exclude or protect secrets.
- Prohibit a general host-shell task runner in the CNC command service.

### 21.2 Unit and property tests

- Capability matrix denies every ungranted operation.
- Command IDs are idempotent under duplicate and concurrent submission.
- Fencing tokens reject old owners.
- State versions reject stale requests.
- Expiry and revocation are monotonic and fail closed.
- Job-package mutation changes the digest and invalidates activation.
- Checkpoint mutation fails cryptographic verification.
- Every checkpoint-invalidating state change is covered.
- MTConnect instance/sequence/freshness transitions produce unknown state.
- OPC UA partial and asynchronous outcomes map correctly.
- Audit serialization is deterministic and redacts secrets.
- Update manifest signature and compatibility rules reject negative cases.
- Recovery procedure selection refuses UNKNOWN engagement.

### 21.3 Integration tests

- Run two clients against one machine broker and prove exclusive ownership.
- Revoke a Session during operation.
- Drop the network before send, after receive, after accept, during action, and before reply.
- Replay delayed packets after lease transfer and controller reset.
- Mutate a share artifact at every transfer/activation boundary.
- Restart sender, broker, Agent, controller simulator, and audit collector independently.
- Overflow telemetry and audit buffers.
- Skew clocks and rotate certificates.
- Exercise local rapid-disconnect during remote maintenance.
- Verify monitoring remains available without gaining command rights.
- Verify local safe stop during cloud, identity, DMZ, and historian failure.

### 21.4 Adversarial security tests

- Anonymous LAN client against every route and Socket.IO event.
- Cross-origin GET/form/image-trigger attempts against state-changing HTTP routes.
- CSRF, WebSocket Origin, CORS, token replay, Session fixation, and forwarded-header tests.
- Brute-force/default credential and credential reuse checks.
- Malformed G-code/project/archive/update payloads.
- Path traversal, symlink, WebDAV, upload ordering, partial-file, and race tests.
- Firmware downgrade, wrong target, revoked signer, expired signer, and manifest substitution.
- Dependency/update/object-store compromise tabletop.
- Camera-bridge SSRF and private-network destination policy.
- Hosted-origin/service-worker compromise simulation.
- Resource exhaustion against low-power controller services.

### 21.5 DNC fault injection

At every byte and block boundary:

- disconnect;
- delay;
- duplicate;
- reorder;
- corrupt;
- reset host;
- reset controller;
- exhaust buffer;
- change source file;
- change share identity;
- lose acknowledgement.

Assert:

- incomplete data never activates;
- last-sent is never used as last-executed;
- outcome-unknown blocks retry/resume;
- controller accepted digest is reverified;
- an edit invalidates approval;
- physical recovery is required after ambiguous execution.

### 21.6 Recovery simulation

Inject interruption:

- before and after every spindle command;
- during spin-up and before at-speed;
- before/during/after every plunge, ramp, contour, retract, and rapid;
- at every planner acknowledgement boundary;
- during probe, drill, tap, thread, toolchange, and workholding transactions;
- after tool/WCS/fixture/manual changes;
- during controller reset and rehome;
- with cutter clear, engaged, stuck, broken, or unknown.

Prove:

- generic resume refuses unsupported/unknown engagement;
- no stationary embedded spindle start occurs;
- no blind retract occurs;
- correct local inspection and consent are required;
- safe escape and re-entry are process-specific;
- checkpoints become single-use and new epochs are created.

### 21.7 Hardware-in-the-loop

- Compare command/broker/controller/audit timestamps and IDs.
- Measure actual spindle at-speed and axis transition behavior.
- Prove guard, E-stop, local/remote mode, workholding, and controller permissives.
- Test network loss without defeating local safety.
- Validate update power-loss recovery on non-production hardware.
- Restore a complete machine environment and compare configuration/logic.
- Perform recovery first with no tool/stock, then a safe test artifact, reduced overrides, single block, and OEM-approved supervision.
- Capture evidence for every blocked unsafe transition.

## 22. KerfDesk phased roadmap

### Phase 0 — immediate safety boundary

1. Treat generic CNC Start-from-line/checkpoint recovery as unsafe for embedded/unknown cutter state.
2. Block automatic router resume unless the tool is locally confirmed clear or a specifically supported recovery procedure proves a safe escape.
3. Replace the current universal M3/dwell-before-retract assumption with a recovery state machine.
4. Make the UI state plainly that acknowledged lines are not executed cuts.
5. Keep external G-code preview-only.
6. Keep remote machine control absent.
7. Keep the desktop update channel disabled.

### Phase 1 — cryptographic local artifacts

1. Add SHA-256 over exact emitted G-code bytes.
2. Define a canonical local job manifest.
3. Bind source project, emitter, machine profile, tool, WCS/setup, and configuration revisions.
4. Upgrade checkpoint identity from FNV-1a to cryptographic job/package identity.
5. Add controller/reset and setup epochs.
6. Store checkpoint consumption and invalidation reasons.
7. Provide operator-visible job and build identity.

### Phase 2 — durable local command journal

1. Assign command IDs to Start, Pause, Stop, reset, setup, and recovery actions.
2. Record requests, writes, acknowledgements, controller state, and outcomes.
3. Persist bounded audit segments asynchronously.
4. Export a redacted diagnostic bundle with hashes and explicit gaps.
5. Separate live transcript UX from retained audit evidence.

### Phase 3 — signed release chain

1. Code-sign Windows releases.
2. Protect signing and publishing identities.
3. Generate and verify artifact provenance and SBOM.
4. Publish immutable versioned artifacts atomically.
5. Sign/authenticate update metadata.
6. Add downgrade, compatibility, and rollback policy.
7. Only then consider changing IS_DESKTOP_UPDATE_CHANNEL_TRUSTED.

### Phase 4 — observation-only networking

1. Define a read-only telemetry schema with source freshness and reset epochs.
2. Bind only to the cell/loopback boundary by default.
3. Use an authenticated TLS gateway/DMZ for off-cell observation.
4. Give telemetry identities no command, upload, update, or shell rights.
5. Test stale, unavailable, restart, sequence gap, and resource exhaustion.

### Phase 5 — staged artifact transfer

1. Introduce quarantine-only upload.
2. Verify exact accepted bytes and target compatibility.
3. Activate immutable digests atomically.
4. Keep activation distinct from program selection and Start.
5. Do not execute a mutable share path.

### Phase 6 — guarded remote requests, only if required

1. Define roles/capabilities and machine-scoped grants.
2. Add local/remote mode and fresh physical consent.
3. Add fenced exclusive execution lease.
4. Add idempotent command IDs and outcome reconciliation.
5. Keep safety sequencing controller-side.
6. Commission each machine/cell separately.
7. Default remote Cycle Start to prohibited.

This order deliberately builds artifact identity, command evidence, release trust, and observation boundaries before exposing control.

## 23. Explicit anti-patterns

- Flat enterprise/controller network.
- “It is on the LAN, so it is trusted.”
- Direct cloud/browser-to-controller command.
- One remoteAccess or administrator Boolean.
- State-changing HTTP GET/HTTP_ANY routes.
- Optional authentication that individual command/file/update paths can bypass.
- Anonymous JWT when no users are configured.
- General shell task runner behind a sender API.
- Plaintext Telnet/FTP/HTTP as an ordinary command path.
- Permissive WebSocket with no identity, Origin, or lease.
- CORS as authorization.
- VPN as the complete security design.
- Multi-variable Write as a safety transaction.
- Blind retry after timeout.
- Matching filename as job verification.
- Executing an in-progress upload.
- Last byte/line sent as restart state.
- READY or heartbeat as local physical readiness.
- Resume from source line without engagement and setup reconstruction.
- Universal spindle-before-motion or motion-before-spindle recovery rule.
- FNV/checksum as adversarial provenance.
- Update hash without an authenticated signer/manifest.
- Enabling auto-update before code-signing and rollback.
- Backups without restore drills.
- Sole reliance on volatile controller/application logs.
- Safety dependency on cloud, identity provider, historian, or audit collector.

## 24. Open evidence and machine-specific unknowns

The following require deployed-machine evidence before implementation:

- exact controller API and firmware version;
- whether the controller can compute/read back program digests;
- block-acceptance, planner, execution, and physical-completion visibility;
- native command idempotency or transaction support;
- actual remote Start interlocks;
- local/remote key switch and safety PLC integration;
- guard, clamp, vacuum, tool, spindle at-speed, and position-feedback signals;
- controller reset and privilege persistence;
- program/data conversion performed during transfer;
- backup contents and restore dependencies;
- update signature/rollback/secure-boot support;
- cycle-time and availability impact of security/logging agents;
- OEM-approved router escape procedures by operation;
- whether physical cutter engagement can be sensed or always needs inspection;
- applicable type-C machine-safety standard and regulatory obligations.

The public documents establish architecture and product capabilities. They do not authorize a generic remote-start implementation on a particular machine.

## 25. Source confidence ledger

| Finding | Confidence | Boundary |
| --- | --- | --- |
| MTConnect REST is read-only/no side effects | Normative, high | Official 2.7 model |
| OPC UA partial Write/uncertain Method semantics | Normative, high | Official OPC Foundation specification |
| NIST zones/DMZ/remote guidance | Official guidance, high | Not a certification mandate |
| IEC 62443 zones/conduits/foundational requirements | Normative concepts, medium-high | Public previews only; no compliance claim |
| Siemens capability and log/backup behavior | Documentation-confirmed, high | Exact machine-builder options may vary |
| Haas/FANUC/HEIDENHAIN/Okuma/Mazak capability boundaries | Documentation-confirmed, medium-high | Public docs do not expose every interlock |
| FluidNC unauthenticated Cycle Start and bypass paths | Source-confirmed, high | No live hardware exploit performed |
| gSender JWT/IP/Socket.IO/shell composition | Source-confirmed, high | No live deployment exploit performed |
| cncjs anonymous-LAN/shell composition | Source-confirmed, high | Intended trust semantics; no live exploit performed |
| KerfDesk Electron/Web Serial/update/checkpoint/log behavior | Source-confirmed, high | Snapshot e752a912 |
| KerfDesk embedded-bit resume hazard | Source-confirmed, high | Exact physical consequence depends on process/machine |
| Proposed zones, leases, job package, state machine, and tests | Engineering inference | Recommended architecture, not quoted standard text |

## 26. Primary sources

### Standards and official guidance

- [NIST SP 800-82 Rev. 3, Guide to OT Security](https://csrc.nist.gov/pubs/sp/800/82/r3/final)
- [CISA Configuring and Managing Remote Access for Industrial Control Systems](https://www.cisa.gov/sites/default/files/recommended_practices/RP_Managing_Remote_Access_S508NC.pdf)
- [ISA/IEC 62443 series overview](https://www.isa.org/standards-and-publications/isa-standards/isa-iec-62443-series-of-standards)
- [ISA 62443-3-2 public preview](https://www.isa.org/getmedia/661c718f-8e64-446d-acf9-2c6286db1b33/isa-62443-3-2-preview.pdf)
- [ISA 62443-3-3 public preview](https://www.isa.org/getmedia/d73509e9-b626-4709-a406-be6fc7616b79/ISA-62443-3-3_Preview.pdf)
- [ISO 12100 machinery risk assessment](https://www.iso.org/standard/51528.html)
- [ISO 16090-1 machining-centre safety](https://www.iso.org/standard/81558.html)
- [ISO/TR 22100-4 machinery safety and IT security](https://www.iso.org/standard/73335.html)
- [IEC TS 63074 safety-related control-system security](https://webstore.iec.ch/en/publication/69228)
- [NIST SP 800-193 platform firmware resiliency](https://csrc.nist.gov/pubs/sp/800/193/final)
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
- [NIST SP 1339 OT Backup Quick Start Guide](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1339.pdf)
- [CISA Secure by Demand for OT owners/operators](https://www.cisa.gov/sites/default/files/2025-01/joint-guide-secure-by-demand-priority-considerations-for-ot-owners-and-operators-508c.pdf)

### Protocols

- [OPC UA Part 2, security model](https://reference.opcfoundation.org/specs/OPC-10000-2/full)
- [OPC UA Part 3, address-space and permissions](https://reference.opcfoundation.org/specs/OPC-10000-3/full)
- [OPC UA Part 4, services](https://reference.opcfoundation.org/specs/OPC-10000-4/full)
- [MTConnect 2.7 Fundamentals](https://model.mtconnect.org/Version2.7/Fundamentals/)
- [MTConnect 2.7 REST protocol](https://model.mtconnect.org/Version2.7/Fundamentals/MTConnectProtocol/RESTProtocol/)
- [MTConnect Execution enumeration](https://model.mtconnect.org/Version2.7/Profile/DataTypes/ExecutionEnum/)

### Product/platform supply chain

- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Electron updating applications](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater/)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [Chrome Web Serial](https://developer.chrome.com/docs/capabilities/serial)

### Controller and vendor documentation

- Siemens sources are linked in section 7.1.
- Haas sources are linked in section 7.2.
- FANUC sources are linked in section 7.3.
- HEIDENHAIN sources are linked in section 7.4.
- Okuma sources are linked in section 7.5.
- Mazak sources are linked in section 7.6.

### Public-source evidence

- FluidNC pinned source links are in section 8.
- gSender pinned source links are in section 9.
- cncjs pinned source links are in section 10.
- KerfDesk findings refer to snapshot e752a9125f02f832144c3b40800840ee5973fcf2.

## 27. Final architecture conclusion

The safest CNC networking design is intentionally asymmetric:

~~~text
telemetry flows outward broadly
artifacts flow inward only through quarantine and verification
commands flow inward narrowly through a fenced guarded transition
safety remains local and independent
audit evidence flows outward durably
updates and restores occur only in explicit maintenance state
~~~

KerfDesk's current local-only machine-control boundary is worth preserving while artifact identity, recovery safety, release signing, and durable auditability are strengthened.

The immediate product lesson is not “add better authentication to Resume.” It is:

> Do not offer automatic CNC recovery until the system can distinguish communication progress from physical progress, classify cutter engagement, bind the exact job and setup, and execute a locally approved machine/process-specific recovery transaction.

Only after that local model is sound should networking be allowed to request it.
