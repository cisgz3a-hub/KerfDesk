// CSS Color 4 colour values, as SVG paint, stop-color and color use them
// (https://www.w3.org/TR/css-color-4/). Imported colours are the operation
// key, so a valid colour this reader did not know used to become black and
// merge separately coloured cut and engrave artwork into one operation.
//
// Scope: the 148 named colours, `transparent`, #rgb, #rgba, #rrggbb and
// #rrggbbaa, and rgb()/rgba(), hsl()/hsla() and hwb() in the legacy comma and
// modern space syntaxes, with percentages, `none` components and alpha. The
// wider-gamut functions (lab, lch, oklab, oklch, color()) and system colours
// are not read; callers treat them as invalid, as a browser without them would.

export type CssColor = {
  /** Lowercase #rrggbb, the operation key the importer stores. */
  readonly hex: string;
  /** 0 (fully transparent) to 1. */
  readonly alpha: number;
};

const NAMED_COLORS: ReadonlyMap<string, string> = new Map(
  (
    'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff ' +
    'beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff ' +
    'blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 ' +
    'chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c ' +
    'cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 ' +
    'darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b ' +
    'darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 ' +
    'darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f ' +
    'darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 ' +
    'deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 ' +
    'floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ' +
    'ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 ' +
    'greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c ' +
    'indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 ' +
    'lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 ' +
    'lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 ' +
    'lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa ' +
    'lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 ' +
    'lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 ' +
    'magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd ' +
    'mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 ' +
    'mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc ' +
    'mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 ' +
    'moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 ' +
    'olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa ' +
    'palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 ' +
    'peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 ' +
    'purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 ' +
    'saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee ' +
    'sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 ' +
    'slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c ' +
    'teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee ' +
    'wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32'
  )
    .split(' ')
    .flatMap((word, index, words) => (index % 2 === 0 ? [[word, `#${words[index + 1]}`]] : []))
    .map(([name, hex]) => [name ?? '', hex ?? ''] as const),
);

// CSS <number>: digits are required after a decimal point.
const NUMBER = String.raw`[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?`;
const COMPONENT = new RegExp(String.raw`^(${NUMBER})(%|deg|grad|rad|turn)?$`);
const FUNCTION = /^(rgba?|hsla?|hwb)\((.*)\)$/s;
const DEGREES_PER_UNIT: Readonly<Record<string, number>> = {
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
};

type Component = { readonly value: number; readonly unit: string } | 'none';
type ComponentList = {
  readonly channels: readonly Component[];
  readonly alpha: Component;
  readonly legacy: boolean;
};

const OPAQUE: Component = { value: 1, unit: '' };

/** The colour a CSS colour value names, or null when it is not one this reader accepts. */
export function parseCssColor(input: string): CssColor | null {
  const text = input.trim().toLowerCase();
  if (text === 'transparent') return { hex: '#000000', alpha: 0 };
  const named = NAMED_COLORS.get(text);
  if (named !== undefined) return { hex: named, alpha: 1 };
  if (text.startsWith('#')) return parseHex(text.slice(1));
  const match = FUNCTION.exec(text);
  if (match === null) return null;
  const name = (match[1] ?? '').replace(/a$/, '');
  const list = componentList(match[2] ?? '', name !== 'hwb');
  if (list === null) return null;
  if (name === 'rgb') return rgbColor(list);
  return hueColor(name === 'hsl' ? 'hsl' : 'hwb', list);
}

function parseHex(digits: string): CssColor | null {
  if (!/^[0-9a-f]+$/.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return null;
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const alpha = full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1;
  return { hex: `#${full.slice(0, 6)}`, alpha };
}

// Legacy syntax separates three channels (and an optional alpha) with commas
// and allows no `none`; modern syntax separates channels with spaces and puts
// alpha after a slash. rgb() and hsl() take both, hwb() only the modern one.
function componentList(body: string, legacyAllowed: boolean): ComponentList | null {
  const text = body.trim();
  if (text.includes(',')) return legacyAllowed ? legacyList(text) : null;
  const [channelText, alphaText, extra] = text.split('/');
  if (extra !== undefined || channelText === undefined) return null;
  const channels = channelText.trim().split(/\s+/).map(component);
  const alpha = alphaText === undefined ? OPAQUE : component(alphaText.trim());
  if (channels.length !== 3 || alpha === null) return null;
  if (!channels.every((channel) => channel !== null)) return null;
  return { channels, alpha, legacy: false };
}

function legacyList(text: string): ComponentList | null {
  const parts = text.split(',').map((part) => component(part.trim()));
  if (parts.length < 3 || parts.length > 4) return null;
  if (!parts.every((part) => part !== null && part !== 'none')) return null;
  return { channels: parts.slice(0, 3), alpha: parts[3] ?? OPAQUE, legacy: true };
}

function component(text: string): Component | null {
  if (text === 'none') return 'none';
  const match = COMPONENT.exec(text);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { value, unit: match[2] ?? '' } : null;
}

// rgb(): numbers are 0-255 and percentages 0-100%. The legacy syntax may not
// mix the two; the modern syntax may.
function rgbColor(list: ComponentList): CssColor | null {
  const units = list.channels.map((channel) => (channel === 'none' ? '' : channel.unit));
  if (units.some((unit) => unit !== '' && unit !== '%')) return null;
  if (list.legacy && new Set(units).size > 1) return null;
  const bytes = list.channels.map((channel) => {
    if (channel === 'none') return 0;
    return channel.unit === '%' ? (channel.value * 255) / 100 : channel.value;
  });
  return colorFromChannels(bytes, list.alpha);
}

function hueColor(kind: 'hsl' | 'hwb', list: ComponentList): CssColor | null {
  const [hueComponent, first, second] = list.channels;
  const hue = hueDegrees(hueComponent);
  const a = percentage(first, list.legacy);
  const b = percentage(second, list.legacy);
  if (hue === null || a === null || b === null) return null;
  const rgb = kind === 'hsl' ? hslToRgb(hue, a, b) : hwbToRgb(hue, a, b);
  return colorFromChannels(
    rgb.map((channel) => channel * 255),
    list.alpha,
  );
}

function hueDegrees(value: Component | undefined): number | null {
  if (value === undefined) return null;
  if (value === 'none') return 0;
  if (value.unit === '') return value.value;
  const factor = DEGREES_PER_UNIT[value.unit];
  return factor === undefined ? null : value.value * factor;
}

// Saturation, lightness, whiteness and blackness: a percentage, or in the
// modern syntax a bare number meaning the same percentage.
function percentage(value: Component | undefined, legacy: boolean): number | null {
  if (value === undefined) return null;
  if (value === 'none') return 0;
  if (value.unit !== '%' && (legacy || value.unit !== '')) return null;
  return Math.min(100, Math.max(0, value.value)) / 100;
}

// CSS Color 4 section 7.1 sample conversion; channels come back as 0-1.
function hslToRgb(hue: number, saturation: number, lightness: number): number[] {
  const turn = ((hue % 360) + 360) % 360;
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map((offset) => {
    const k = (offset + turn / 30) % 12;
    return lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  });
}

// CSS Color 4 section 8.1: whiteness and blackness that sum past 100% are grey.
function hwbToRgb(hue: number, whiteness: number, blackness: number): number[] {
  if (whiteness + blackness >= 1) {
    const grey = whiteness / (whiteness + blackness);
    return [grey, grey, grey];
  }
  return hslToRgb(hue, 1, 0.5).map((channel) => channel * (1 - whiteness - blackness) + whiteness);
}

function colorFromChannels(
  channels: readonly number[],
  alphaComponent: Component,
): CssColor | null {
  const alpha = alphaValue(alphaComponent);
  if (alpha === null) return null;
  // Rounding to micro-units first keeps float noise from deciding a half-way
  // channel (hwb(200 10 10) is 161.49999999999997 green, not 161.5).
  const hex = channels
    .map((channel) => Math.min(255, Math.max(0, Math.round(Number(channel.toFixed(6))))))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('');
  return { hex: `#${hex}`, alpha };
}

function alphaValue(value: Component): number | null {
  if (value === 'none') return 0;
  if (value.unit !== '' && value.unit !== '%') return null;
  const fraction = value.unit === '%' ? value.value / 100 : value.value;
  return Math.min(1, Math.max(0, fraction));
}
