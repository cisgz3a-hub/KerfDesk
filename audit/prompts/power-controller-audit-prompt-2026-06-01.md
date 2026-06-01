# LaserForge 2.0 Power/Controller Audit Prompt

You are auditing LaserForge 2.0 after a real overburn incident: a user ran what they believed was a 30% power engraving and it cut through a 6 mm board.

Do not change production code during this audit. Build an evidence map from UI inputs to emitted G-code and controller behavior:

1. Trace `Layer` settings through `compileJob`, raster/vector compilation, preflight, `grblStrategy`, `emitRasterGroup`, and live streaming.
2. Record every power-affecting value and assumption: layer power, min/max power model, speed units, passes, line/fill/image mode, trace-vs-raster semantics, hatch spacing, lines/mm, `$30`, `$31`, `$32`, `M3`, `M4`, `M5`, `S0`, feed rate, and controller-detected settings.
3. Compare the code against primary GRBL documentation and current LightBurn documentation.
4. Separate confirmed code facts, confirmed external-source facts, and hypotheses.
5. For every finding, include path, function/module, trigger path, failure mode, consequence, severity, confidence, concrete fix, and verification/burn-test plan.
6. Reject vague best-practice advice and do not call anything release-blocking without a realistic trigger path.

Research sources used:

- GRBL v1.1 laser mode documentation.
- GRBL settings documentation for `$30`, `$31`, and `$32`.
- LightBurn GRBL setup, S-value max, cut settings, line mode, speed/power, and material-test documentation.
