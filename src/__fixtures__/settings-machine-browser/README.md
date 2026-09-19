# Manual settings repair browser fixtures

Start the development server in this checkout, then open
`/src/__fixtures__/settings-machine-browser/index.html` for two artworks sharing
an operation with differing effective values. Use `?fixture=f0` for the audit's
30%, 1500 mm/min, one-pass, 0.1 mm pitch, 5 mm overscan Fill fixture.

The fixture deserializes synthetic project JSON and mounts the ordinary application.
Use its controls to check mixed edits, undo, Advanced and Inspect G-code. This is
browser verification of initialized fixtures; it does not qualify the native file
picker, controller connection, motion or optical/material output.
