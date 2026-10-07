// Fixed programs captured from f12f7ac4aaaea8a50816c0213e93c73615992c3a's
// compiler and optimizer, before operation topology changed. The capture used
// the unchanged emitter without a provenance header. These are sealed byte
// controls, not snapshots regenerated from the implementation under test.
export const PRE_K1_BYTES = {
  'repeated-source': `G21
G90
G54
G94
M4 S0
; layer cut color #000000 power 80% speed 1200 mm/min passes 2
; pass 1 of 2
G0 X10.000 Y10.000 S0
G1 X20.000 Y10.000 F1200 S800
G1 X20.000 Y20.000
G1 X10.000 Y20.000
G1 X10.000 Y10.000
; pass 2 of 2
G0 X10.000 Y10.000 S0
G1 X20.000 Y10.000 F1200 S800
G1 X20.000 Y20.000
G1 X10.000 Y20.000
G1 X10.000 Y10.000
; layer cut color #000000 power 40% speed 1200 mm/min passes 2
; pass 1 of 2
G0 X40.000 Y10.000 S0
G1 X50.000 Y10.000 F1200 S400
G1 X50.000 Y20.000
G1 X40.000 Y20.000
G1 X40.000 Y10.000
; pass 2 of 2
G0 X40.000 Y10.000 S0
G1 X50.000 Y10.000 F1200 S400
G1 X50.000 Y20.000
G1 X40.000 Y20.000
G1 X40.000 Y10.000
; layer cut color #000000 power 80% speed 1200 mm/min passes 2
; pass 1 of 2
G0 X70.000 Y10.000 S0
G1 X80.000 Y10.000 F1200 S800
G1 X80.000 Y20.000
G1 X70.000 Y20.000
G1 X70.000 Y10.000
; pass 2 of 2
G0 X70.000 Y10.000 S0
G1 X80.000 Y10.000 F1200 S800
G1 X80.000 Y20.000
G1 X70.000 Y20.000
G1 X70.000 Y10.000
M5
G0 X0.000 Y0.000 S0
`,
  'repeated-no-inside': `G21
G90
G54
G94
M4 S0
; layer cut color #000000 power 80% speed 1200 mm/min passes 2
; pass 1 of 2
G0 X10.000 Y10.000 S0
G1 X20.000 Y10.000 F1200 S800
G1 X20.000 Y20.000
G1 X10.000 Y20.000
G1 X10.000 Y10.000
; pass 2 of 2
G0 X10.000 Y10.000 S0
G1 X20.000 Y10.000 F1200 S800
G1 X20.000 Y20.000
G1 X10.000 Y20.000
G1 X10.000 Y10.000
; layer cut color #000000 power 40% speed 1200 mm/min passes 2
; pass 1 of 2
G0 X40.000 Y10.000 S0
G1 X50.000 Y10.000 F1200 S400
G1 X50.000 Y20.000
G1 X40.000 Y20.000
G1 X40.000 Y10.000
; pass 2 of 2
G0 X40.000 Y10.000 S0
G1 X50.000 Y10.000 F1200 S400
G1 X50.000 Y20.000
G1 X40.000 Y20.000
G1 X40.000 Y10.000
; layer cut color #000000 power 80% speed 1200 mm/min passes 2
; pass 1 of 2
G0 X70.000 Y10.000 S0
G1 X80.000 Y10.000 F1200 S800
G1 X80.000 Y20.000
G1 X70.000 Y20.000
G1 X70.000 Y10.000
; pass 2 of 2
G0 X70.000 Y10.000 S0
G1 X80.000 Y10.000 F1200 S800
G1 X80.000 Y20.000
G1 X70.000 Y20.000
G1 X70.000 Y10.000
M5
G0 X0.000 Y0.000 S0
`,
  'native-arc': `G21
G90
G54
G94
G17
M4 S0
; layer cut color #000000 power 80% speed 1200 mm/min passes 1
; pass 1 of 1
G0 X60.000 Y40.000 S0
G3 X40.004 Y40.280 I-10.000 J0.000 F1200 S800
G3 X59.985 Y39.442 I9.996 J-0.275
G1 X60.000 Y40.000
M5
G0 X0.000 Y0.000 S0
`,
  'mixed-open': `G21
G90
G54
G94
M4 S0
; layer cut color #000000 power 80% speed 1200 mm/min passes 1
; pass 1 of 1
G0 X20.000 Y20.000 S0
G1 X30.000 Y20.000 F1200 S800
G0 X10.000 Y10.000 S0
G1 X90.000 Y10.000 F1200 S800
G1 X90.000 Y90.000
G1 X10.000 Y90.000
G1 X10.000 Y10.000
G0 X100.000 Y40.000 S0
G1 X110.000 Y40.000 F1200 S800
M5
G0 X0.000 Y0.000 S0
`,
  'uniform-fill': `G21
G90
G54
G94
M4 S0
; fill layer cut color #000000 power 80% speed 1200 mm/min passes 1 overscan 0.000 mm; generic minimum 5.000 mm applied (feed-matched entry and exit up to 5.000 mm on every Scan Line sweep)
; pass 1 of 1
G0 X5.000 Y10.000 S0
G1 X10.000 Y10.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X90Y10F1200S800
G1 X95.000 Y10.000 F1200 S0 ; kerfdesk:laser-off-motion
G0 X95.000 Y20.000 S0
G1 X90.000 Y20.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X10Y20F1200S800
G1 X5.000 Y20.000 F1200 S0 ; kerfdesk:laser-off-motion
G0 X5.000 Y30.000 S0
G1 X10.000 Y30.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X30Y30F1200S800
G1 X35.000 Y30.000 F1200 S0 ; kerfdesk:laser-off-motion
G0 X45.000 Y30.000 S0
G1 X50.000 Y30.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X90Y30F1200S800
G1 X95.000 Y30.000 F1200 S0 ; kerfdesk:laser-off-motion
G0 X95.000 Y40.000 S0
G1 X90.000 Y40.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X50Y40F1200S800
G1 X45.000 Y40.000 F1200 S0 ; kerfdesk:laser-off-motion
G0 X35.000 Y40.000 S0
G1 X30.000 Y40.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X10Y40F1200S800
G1 X5.000 Y40.000 F1200 S0 ; kerfdesk:laser-off-motion
G0 X5.000 Y50.000 S0
G1 X10.000 Y50.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X90Y50F1200S800
G1 X95.000 Y50.000 F1200 S0 ; kerfdesk:laser-off-motion
G0 X95.000 Y60.000 S0
G1 X90.000 Y60.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X10Y60F1200S800
G1 X5.000 Y60.000 F1200 S0 ; kerfdesk:laser-off-motion
G0 X5.000 Y70.000 S0
G1 X10.000 Y70.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X90Y70F1200S800
G1 X95.000 Y70.000 F1200 S0 ; kerfdesk:laser-off-motion
G0 X95.000 Y80.000 S0
G1 X90.000 Y80.000 F1200 S0 ; kerfdesk:laser-off-motion
G1X10Y80F1200S800
G1 X5.000 Y80.000 F1200 S0 ; kerfdesk:laser-off-motion
M5
G0 X0.000 Y0.000 S0
`,
  'uniform-line-passes': `G21
G90
G54
G94
M4 S0
; layer cut color #000000 power 80% speed 1200 mm/min passes 2
; pass 1 of 2
G0 X10.000 Y10.000 S0
G1 X20.000 Y10.000 F1200 S800
G1 X20.000 Y20.000
G1 X10.000 Y20.000
G1 X10.000 Y10.000
G0 X40.000 Y10.000 S0
G1 X50.000 Y10.000 F1200 S800
G1 X50.000 Y20.000
G1 X40.000 Y20.000
G1 X40.000 Y10.000
G0 X70.000 Y10.000 S0
G1 X80.000 Y10.000 F1200 S800
G1 X80.000 Y20.000
G1 X70.000 Y20.000
G1 X70.000 Y10.000
; pass 2 of 2
G0 X10.000 Y10.000 S0
G1 X20.000 Y10.000 F1200 S800
G1 X20.000 Y20.000
G1 X10.000 Y20.000
G1 X10.000 Y10.000
G0 X40.000 Y10.000 S0
G1 X50.000 Y10.000 F1200 S800
G1 X50.000 Y20.000
G1 X40.000 Y20.000
G1 X40.000 Y10.000
G0 X70.000 Y10.000 S0
G1 X80.000 Y10.000 F1200 S800
G1 X80.000 Y20.000
G1 X70.000 Y20.000
G1 X70.000 Y10.000
M5
G0 X0.000 Y0.000 S0
`,
  'one-pass-cleanup': `G21
G90
G54
G94
M4 S0
; layer cut color #000000 power 80% speed 1200 mm/min passes 1
; pass 1 of 1
G0 X10.000 Y10.000 S0
G1 X0.000 Y10.000 F1200 S800
G1 X0.000 Y0.000
G1 X10.000 Y0.000
G1 X10.000 Y10.000
G0 X10.000 Y20.000 S0
G1 X10.000 Y10.000 F1200 S800
G0 X0.000 Y10.000 S0
G1 X0.000 Y20.000 F1200 S800
G1 X10.000 Y20.000
M5
G0 X0.000 Y0.000 S0
`,
  'historical-nesting': `G21
G90
G54
G94
M4 S0
; layer cut color #000000 power 80% speed 1200 mm/min passes 2
; requested override: mode line; kerf 0 mm
; pass 1 of 2
G0 X30.000 Y30.000 S0
G1 X40.000 Y30.000 F1200 S800
G1 X40.000 Y40.000
G1 X30.000 Y40.000
G1 X30.000 Y30.000
G0 X10.000 Y10.000 S0
G1 X90.000 Y10.000 F1200 S800
G1 X90.000 Y90.000
G1 X10.000 Y90.000
G1 X10.000 Y10.000
; pass 2 of 2
G0 X30.000 Y30.000 S0
G1 X40.000 Y30.000 F1200 S800
G1 X40.000 Y40.000
G1 X30.000 Y40.000
G1 X30.000 Y30.000
G0 X10.000 Y10.000 S0
G1 X90.000 Y10.000 F1200 S800
G1 X90.000 Y90.000
G1 X10.000 Y90.000
G1 X10.000 Y10.000
; layer cut color #000000 power 40% speed 600 mm/min passes 1
; requested override: mode line; kerf 0 mm
; pass 1 of 1
G0 X20.000 Y20.000 S0
G1 X70.000 Y20.000 F600 S400
G1 X70.000 Y70.000
G1 X20.000 Y70.000
G1 X20.000 Y20.000
M5
G0 X0.000 Y0.000 S0
`,
} as const;
export const PRE_K1_FINGERPRINTS = {
  'repeated-source': {
    fnv1a: 3784617137,
    chars: 972,
    lines: 47,
  },
  'repeated-no-inside': {
    fnv1a: 3784617137,
    chars: 972,
    lines: 47,
  },
  'native-arc': {
    fnv1a: 2256567703,
    chars: 247,
    lines: 15,
  },
  'mixed-open': {
    fnv1a: 3035347207,
    chars: 337,
    lines: 19,
  },
  'uniform-fill': {
    fnv1a: 609247327,
    chars: 1761,
    lines: 50,
  },
  'uniform-line-passes': {
    fnv1a: 650713323,
    chars: 790,
    lines: 41,
  },
  'one-pass-cleanup': {
    fnv1a: 3722277777,
    chars: 348,
    lines: 20,
  },
  'historical-nesting': {
    fnv1a: 2215200740,
    chars: 842,
    lines: 40,
  },
} as const;
