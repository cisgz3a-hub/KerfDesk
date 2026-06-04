# Karpathy Image-To-Burn Audit Prompt - 2026-06-03

## Objective

Audit the complete LaserForge image workflow from import to physical burn output:

1. Raster image import.
2. Trace preview and trace commit.
3. Traced/vector object persistence in `.lf2`.
4. Layer mode selection: Line, Fill, Image.
5. Fill hatching and raster engraving compile.
6. Preview/toolpath/estimate.
7. G-code emission and preflight.
8. Start/serial streaming, stop/pause/disconnect safety.
9. Supplied real artifacts: `.lf2`, exported `.gcode`, hardware burn observations.

Use Karpathy-style discipline: inspect the actual data path, reduce claims to measurable checks, reject vibe-based conclusions, and separate what is structurally tested from what is visually/hardware verified.

## Audit Rules

- Do not change production code during this audit.
- Do not invent findings. Every finding needs file path, module/function, trigger path, failure mode, consequence, severity, confidence, and concrete fix.
- Prefer actual artifacts over assumptions. Inspect supplied `.lf2` and `.gcode` files directly.
- Cross-check workflow claims against LightBurn behavior where available.
- Cross-check GRBL/G-code claims against GRBL laser-mode docs.
- Treat green tests as structural evidence only. They do not prove trace smoothness, small-letter readability, or material burn quality.
- Reject duplicate findings and false positives before scoring.

## Required External References

- LightBurn Image Tracing docs: trace works best on clear-edged images, has Cutoff/Threshold, Ignore less than, Smoothness, Optimize, and preview/fade controls.
- LightBurn Fill Mode docs: Fill scans closed shapes, line interval/lines-per-inch define row spacing, overscanning uses laser-off moves outside the engrave area, and fill grouping affects blank travel strategy.
- LightBurn Preview docs: preview should represent the path sent to the laser, including optimization settings and job origin.
- GRBL v1.1 Laser Mode docs: `G0` rapid mode enforces laser disabled; `S0` turns laser off during valid motion; CAM may use `G0` for unpowered moves between raster regions.
- MDN Web Serial disconnect docs: disconnect is an event after the port becomes unavailable; software must notify/recover honestly.

## Findings Template

```text
ID:
Title:
Severity:
Confidence:
File / module:
Function / component:
Trigger path:
Failure mode:
Consequence:
Evidence:
External reference:
Concrete fix:
Verification needed:
```

## Workflow Checklist

- Import displays the same image data that later burns or explicitly warns when it does not.
- Trace preview cannot be overwritten by stale async results.
- Trace commit uses the same options/source grid as preview.
- Project persistence round-trips raster, trace, trace-source, luma, layer mode, and transforms.
- Preview uses the same prepared job pipeline as G-code emission.
- Fill hatching does not create long feed-speed `G1 S0` blank moves across separate regions.
- Preflight catches or warns about material-visible blank feed moves.
- Small-feature density is measured, not guessed.
- Raster jobs are budgeted before allocating full luma/S-value/G-code buffers.
- Save G-code and Start Job surface the same operator-intent warnings.
- Stop/Pause/Disconnect write failures are visible to the operator, especially during jobs.
- Mid-job disconnect shows a physical E-stop / power warning and requires recovery.
