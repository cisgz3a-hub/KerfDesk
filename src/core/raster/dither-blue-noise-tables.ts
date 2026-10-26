// Weight tables for the 'blue-noise' error diffusion (dither-blue-noise.ts,
// ADR-649). Kept in their own file so the published table can be checked line
// by line against its source.

/**
 * Ostromoukhov, "A Simple and Efficient Error-Diffusion Algorithm",
 * SIGGRAPH 2001, Appendix I: integer error-filter weights for input levels
 * 0..127, transcribed verbatim, in the paper's order A10, A-11, A01 — the
 * pixel ahead on the scan line, the pixel behind it on the next row, and the
 * pixel below. Each row is normalized by its sum; level g above 127 uses row
 * 255 - g. dither-blue-noise.ts uses the rows up to the first key level below.
 */
export const OSTROMOUKHOV_2001_WEIGHTS: ReadonlyArray<readonly [number, number, number]> = [
  [13, 0, 5], // 0
  [13, 0, 5], // 1
  [21, 0, 10], // 2
  [7, 0, 4], // 3
  [8, 0, 5], // 4
  [47, 3, 28], // 5
  [23, 3, 13], // 6
  [15, 3, 8], // 7
  [22, 6, 11], // 8
  [43, 15, 20], // 9
  [7, 3, 3], // 10
  [501, 224, 211], // 11
  [249, 116, 103], // 12
  [165, 80, 67], // 13
  [123, 62, 49], // 14
  [489, 256, 191], // 15
  [81, 44, 31], // 16
  [483, 272, 181], // 17
  [60, 35, 22], // 18
  [53, 32, 19], // 19
  [237, 148, 83], // 20
  [471, 304, 161], // 21
  [3, 2, 1], // 22
  [481, 314, 185], // 23
  [354, 226, 155], // 24
  [1389, 866, 685], // 25
  [227, 138, 125], // 26
  [267, 158, 163], // 27
  [327, 188, 220], // 28
  [61, 34, 45], // 29
  [627, 338, 505], // 30
  [1227, 638, 1075], // 31
  [20, 10, 19], // 32
  [1937, 1000, 1767], // 33
  [977, 520, 855], // 34
  [657, 360, 551], // 35
  [71, 40, 57], // 36
  [2005, 1160, 1539], // 37
  [337, 200, 247], // 38
  [2039, 1240, 1425], // 39
  [257, 160, 171], // 40
  [691, 440, 437], // 41
  [1045, 680, 627], // 42
  [301, 200, 171], // 43
  [177, 120, 95], // 44
  [2141, 1480, 1083], // 45
  [1079, 760, 513], // 46
  [725, 520, 323], // 47
  [137, 100, 57], // 48
  [2209, 1640, 855], // 49
  [53, 40, 19], // 50
  [2243, 1720, 741], // 51
  [565, 440, 171], // 52
  [759, 600, 209], // 53
  [1147, 920, 285], // 54
  [2311, 1880, 513], // 55
  [97, 80, 19], // 56
  [335, 280, 57], // 57
  [1181, 1000, 171], // 58
  [793, 680, 95], // 59
  [599, 520, 57], // 60
  [2413, 2120, 171], // 61
  [405, 360, 19], // 62
  [2447, 2200, 57], // 63
  [11, 10, 0], // 64
  [158, 151, 3], // 65
  [178, 179, 7], // 66
  [1030, 1091, 63], // 67
  [248, 277, 21], // 68
  [318, 375, 35], // 69
  [458, 571, 63], // 70
  [878, 1159, 147], // 71
  [5, 7, 1], // 72
  [172, 181, 37], // 73
  [97, 76, 22], // 74
  [72, 41, 17], // 75
  [119, 47, 29], // 76
  [4, 1, 1], // 77
  [4, 1, 1], // 78
  [4, 1, 1], // 79
  [4, 1, 1], // 80
  [4, 1, 1], // 81
  [4, 1, 1], // 82
  [4, 1, 1], // 83
  [4, 1, 1], // 84
  [4, 1, 1], // 85
  [65, 18, 17], // 86
  [95, 29, 26], // 87
  [185, 62, 53], // 88
  [30, 11, 9], // 89
  [35, 14, 11], // 90
  [85, 37, 28], // 91
  [55, 26, 19], // 92
  [80, 41, 29], // 93
  [155, 86, 59], // 94
  [5, 3, 2], // 95
  [5, 3, 2], // 96
  [5, 3, 2], // 97
  [5, 3, 2], // 98
  [5, 3, 2], // 99
  [5, 3, 2], // 100
  [5, 3, 2], // 101
  [5, 3, 2], // 102
  [5, 3, 2], // 103
  [5, 3, 2], // 104
  [5, 3, 2], // 105
  [5, 3, 2], // 106
  [5, 3, 2], // 107
  [305, 176, 119], // 108
  [155, 86, 59], // 109
  [105, 56, 39], // 110
  [80, 41, 29], // 111
  [65, 32, 23], // 112
  [55, 26, 19], // 113
  [335, 152, 113], // 114
  [85, 37, 28], // 115
  [115, 48, 37], // 116
  [35, 14, 11], // 117
  [355, 136, 109], // 118
  [30, 11, 9], // 119
  [365, 128, 107], // 120
  [185, 62, 53], // 121
  [25, 8, 7], // 122
  [95, 29, 26], // 123
  [385, 112, 103], // 124
  [65, 18, 17], // 125
  [395, 104, 101], // 126
  [4, 1, 1], // 127
];

export type BlueNoiseKeyLevel = {
  readonly level: number;
  /** Error-filter weights [ahead, behind-below, below]; normalized by their sum. */
  readonly weights: readonly [number, number, number];
  /** Threshold modulation strength m, in luma units: threshold = 128 + m * noise. */
  readonly modulation: number;
};

/**
 * Midtone key levels, tuned for KerfDesk (ADR-649) by the procedure both papers
 * describe: at each key level, search the weights (steps of 0.05) and the
 * modulation strength for the output whose spectrum is closest to blue noise,
 * then interpolate linearly between key levels. The cost was the share of
 * power below half the blue-noise principal frequency plus 0.01 x Ulichney's
 * anisotropy, averaged over the key level and the levels 3 either side, on
 * flat 288 px fields. Zhou & Fang's own tables were not available to check, so
 * none of their numbers are used.
 *
 * The first entry is Ostromoukhov's row for its level with no modulation:
 * every level below it uses the published table as it is.
 */
export const BLUE_NOISE_KEY_LEVELS: ReadonlyArray<BlueNoiseKeyLevel> = [
  { level: 48, weights: [137, 100, 57], modulation: 0 },
  { level: 56, weights: [0.4, 0.3, 0.3], modulation: 8 },
  { level: 64, weights: [0.4, 0.2, 0.4], modulation: 16 },
  { level: 72, weights: [0.35, 0.2, 0.45], modulation: 8 },
  { level: 80, weights: [0.35, 0.25, 0.4], modulation: 16 },
  { level: 85, weights: [0.4, 0.25, 0.35], modulation: 16 },
  { level: 92, weights: [0.4, 0.3, 0.3], modulation: 8 },
  { level: 100, weights: [0.35, 0.3, 0.35], modulation: 8 },
  { level: 116, weights: [0.35, 0.3, 0.35], modulation: 8 },
  { level: 122, weights: [0.4, 0.25, 0.35], modulation: 8 },
  { level: 127, weights: [0.4, 0.25, 0.35], modulation: 8 },
];
