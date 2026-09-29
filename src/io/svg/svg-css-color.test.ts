import { describe, expect, it } from 'vitest';
import { parseCssColor } from './svg-css-color';

const opaque = (hex: string) => ({ hex, alpha: 1 });

describe('parseCssColor', () => {
  it.each([
    ['red', '#ff0000'],
    ['steelblue', '#4682b4'],
    ['darkred', '#8b0000'],
    ['rebeccapurple', '#663399'],
    ['lightgoldenrodyellow', '#fafad2'],
    ['grey', '#808080'],
    ['DarkSlateGrey', '#2f4f4f'],
  ])('reads the CSS named colour %s', (name, hex) => {
    expect(parseCssColor(name)).toEqual(opaque(hex));
  });

  it('reads transparent as transparent black', () => {
    expect(parseCssColor('transparent')).toEqual({ hex: '#000000', alpha: 0 });
  });

  it.each([
    ['#f00', opaque('#ff0000')],
    ['#F00', opaque('#ff0000')],
    ['#ff0000', opaque('#ff0000')],
    ['#f008', { hex: '#ff0000', alpha: 0x88 / 255 }],
    ['#ff000080', { hex: '#ff0000', alpha: 0x80 / 255 }],
  ])('reads the hex colour %s', (text, color) => {
    expect(parseCssColor(text)).toEqual(color);
  });

  it.each([
    ['rgb(255, 0, 0)', '#ff0000'],
    ['rgb(100%, 0%, 0%)', '#ff0000'],
    ['rgb(100%,50%,0%)', '#ff8000'],
    ['rgb(255 0 0)', '#ff0000'],
    ['rgb(255 0% 0)', '#ff0000'],
    ['rgb(127.5, 0, 0)', '#800000'],
    ['rgb(300, -5, 0)', '#ff0000'],
    ['rgb(none 128 0)', '#008000'],
    ['RGBA(0, 128, 0, 1)', '#008000'],
    ['hsl(240, 100%, 50%)', '#0000ff'],
    ['hsl(240 100% 50%)', '#0000ff'],
    ['hsl(240 100 50)', '#0000ff'],
    ['hsl(0.5turn 100% 50%)', '#00ffff'],
    ['hsl(200grad 100% 50%)', '#00ffff'],
    ['hsl(-120deg 100% 50%)', '#0000ff'],
    ['hwb(120 20% 30%)', '#33b333'],
    ['hwb(0 60% 60%)', '#808080'],
  ])('reads the colour function %s', (text, hex) => {
    expect(parseCssColor(text)).toEqual(opaque(hex));
  });

  it.each([
    ['rgba(0, 128, 0, 0.5)', 0.5],
    ['rgb(255 0 0 / 25%)', 0.25],
    ['hsla(120, 100%, 25%, 0.5)', 0.5],
    ['rgb(255 0 0 / none)', 0],
    ['rgb(255, 0, 0, 0)', 0],
    ['rgb(0 0 0 / 150%)', 1],
  ])('reads the alpha of %s', (text, alpha) => {
    expect(parseCssColor(text)?.alpha).toBe(alpha);
  });

  it.each([
    'rgb(255, 0%, 0)',
    'rgb(none, 128, 0)',
    'rgb(255, 0, 0 / 1)',
    'rgb(255 0 0 0)',
    'rgb (255, 0, 0)',
    'rgb(255,0,0',
    'rgb(1., 0, 0)',
    'hsl(240, 100, 50)',
    'hwb(0, 0%, 0%)',
    '#ff00000',
    '#ggg',
    'lab(50% 40 59)',
    'currentcolor',
    'none',
    'constructor',
    '__proto__',
    '',
  ])('rejects %j, which this reader does not accept as a colour', (text) => {
    expect(parseCssColor(text)).toBeNull();
  });
});
