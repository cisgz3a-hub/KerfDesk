import { describe, expect, it } from 'vitest';
import { evaluateNumericEntry, type NumericEntryOptions } from './numeric-expression';

const LENGTH: NumericEntryOptions = { kind: 'length' };
const SIZE: NumericEntryOptions = { kind: 'length', percentOf: 80 };
const ANGLE: NumericEntryOptions = { kind: 'angle' };

function valueOf(text: string, options: NumericEntryOptions = LENGTH): number {
  const result = evaluateNumericEntry(text, options);
  if (result.kind !== 'ok') throw new Error(`"${text}" was refused: ${result.message}`);
  return result.value;
}

function messageFor(text: string, options: NumericEntryOptions = LENGTH): string {
  const result = evaluateNumericEntry(text, options);
  if (result.kind !== 'invalid') throw new Error(`"${text}" was accepted as ${result.value}`);
  return result.message;
}

describe('evaluateNumericEntry', () => {
  it('reads plain numbers with a decimal point', () => {
    expect(valueOf('12')).toBe(12);
    expect(valueOf('12.5')).toBe(12.5);
    expect(valueOf('.5')).toBe(0.5);
    expect(valueOf('12.')).toBe(12);
    expect(valueOf('  -7.25  ')).toBe(-7.25);
    expect(valueOf('1e3')).toBe(1000);
  });

  it('applies operator precedence and parentheses', () => {
    expect(valueOf('2+3*4')).toBe(14);
    expect(valueOf('(2+3)*4')).toBe(20);
    expect(valueOf('10-4-3')).toBe(3);
    expect(valueOf('100/10/5')).toBe(2);
    expect(valueOf('25.4 * 2')).toBeCloseTo(50.8, 10);
    expect(valueOf('2 * (3 + (4 - 1))')).toBe(12);
  });

  it('treats ^ as a right-associative power that binds tighter than unary minus', () => {
    expect(valueOf('2^3^2')).toBe(512);
    expect(valueOf('-2^2')).toBe(-4);
    expect(valueOf('2^-1')).toBe(0.5);
    expect(valueOf('2*3^2')).toBe(18);
  });

  it('handles unary signs, pi, sqrt and abs', () => {
    expect(valueOf('--5')).toBe(5);
    expect(valueOf('+5')).toBe(5);
    expect(valueOf('3*-2')).toBe(-6);
    expect(valueOf('pi')).toBe(Math.PI);
    expect(valueOf('2*PI')).toBe(2 * Math.PI);
    expect(valueOf('sqrt(16)')).toBe(4);
    expect(valueOf('abs(3-10)')).toBe(7);
    expect(valueOf('sqrt ( 9 ) + 1')).toBe(4);
  });

  it('has e, logarithms and trigonometry in degrees', () => {
    expect(valueOf('e')).toBe(Math.E);
    expect(valueOf('ln(e)')).toBe(1);
    expect(valueOf('log(1000)')).toBe(3);
    expect(valueOf('sin(30)')).toBeCloseTo(0.5, 12);
    expect(valueOf('100*cos(60)')).toBeCloseTo(50, 10);
    expect(valueOf('tan(45)')).toBeCloseTo(1, 12);
    expect(valueOf('atan(1)', ANGLE)).toBeCloseTo(45, 12);
    expect(valueOf('asin(0.5)', ANGLE)).toBeCloseTo(30, 12);
    expect(valueOf('acos(0)', ANGLE)).toBeCloseTo(90, 12);
    expect(valueOf('1e3')).toBe(1000);
  });

  it('converts length units to millimetres', () => {
    expect(valueOf('1in')).toBe(25.4);
    expect(valueOf('1"')).toBe(25.4);
    expect(valueOf('(1+1)in')).toBeCloseTo(50.8, 10);
    expect(valueOf('2.5cm')).toBe(25);
    expect(valueOf('12 mm')).toBe(12);
    expect(valueOf('1in + 10')).toBeCloseTo(35.4, 10);
    expect(valueOf('-1IN')).toBe(-25.4);
  });

  it('applies a unit on the last factor alone to the whole product', () => {
    expect(valueOf('1/2in')).toBeCloseTo(12.7, 10);
    expect(valueOf('3/4in')).toBeCloseTo(19.05, 10);
    expect(valueOf('3/4"')).toBeCloseTo(19.05, 10);
    expect(valueOf('1in+1/2in')).toBeCloseTo(38.1, 10);
    expect(valueOf('1/-2in')).toBeCloseTo(-12.7, 10);
    expect(valueOf('-1/2 in')).toBeCloseTo(-12.7, 10);
    expect(valueOf('3/2cm')).toBeCloseTo(15, 10);
    expect(valueOf('1/2%', SIZE)).toBeCloseTo(0.4, 10);
  });

  it('keeps a unit on its own number when another factor has one or it is not last', () => {
    expect(valueOf('3*2mm')).toBe(6);
    expect(valueOf('3*2in')).toBeCloseTo(152.4, 10);
    expect(valueOf('10mm/2')).toBe(5);
    expect(valueOf('1in/2')).toBeCloseTo(12.7, 10);
    expect(valueOf('(1/2)in')).toBeCloseTo(12.7, 10);
    expect(valueOf('2in/4in')).toBe(0.5);
    expect(messageFor('1/0in')).toBe('it divides by zero');
  });

  it('reads angles in degrees', () => {
    expect(valueOf('90', ANGLE)).toBe(90);
    expect(valueOf('45deg', ANGLE)).toBe(45);
    expect(valueOf('30° + 15', ANGLE)).toBe(45);
    expect(valueOf('360/8', ANGLE)).toBe(45);
  });

  it('refuses a unit of the wrong kind', () => {
    expect(messageFor('1in', ANGLE)).toBe('"in" is a length unit, but this box takes an angle');
    expect(messageFor('1"', ANGLE)).toBe(
      'the inch mark (") is a length unit, but this box takes an angle',
    );
    expect(messageFor('45deg')).toBe('"deg" is an angle unit, but this box takes a length');
    expect(messageFor('45°')).toBe('"°" is an angle unit, but this box takes a length');
  });

  it('takes percentages of the current value only where the caller allows them', () => {
    expect(valueOf('50%', SIZE)).toBe(40);
    expect(valueOf('50% + 10', SIZE)).toBe(50);
    expect(valueOf('150%', SIZE)).toBe(120);
    expect(messageFor('50%')).toBe('percentages only work in Width and Height');
    expect(messageFor('50%', ANGLE)).toBe('percentages only work in Width and Height');
  });

  it('refuses malformed entries with a short reason', () => {
    expect(messageFor('')).toBe('the box is empty');
    expect(messageFor('   ')).toBe('the box is empty');
    expect(messageFor('10++')).toBe('a number is missing after "+"');
    expect(messageFor('10*')).toBe('a number is missing after "*"');
    expect(messageFor('*10')).toBe('"*" needs a number in front of it');
    expect(messageFor('12,5')).toBe('use a dot for decimals, not a comma');
    expect(messageFor('10/0')).toBe('it divides by zero');
    expect(messageFor('10/(2-2)')).toBe('it divides by zero');
    expect(messageFor('(1+2')).toBe('a closing bracket ")" is missing');
    expect(messageFor('1+2)')).toBe('")" has no matching "("');
    expect(messageFor('()')).toBe('a number is missing after "("');
    expect(messageFor('2 3')).toBe('an operator such as + or * is missing before "3"');
    expect(messageFor('2pi')).toBe('an operator such as + or * is missing before "pi"');
    expect(messageFor('abc')).toBe('"abc" isn\'t a unit or function this box knows');
    expect(messageFor('sqrt 4')).toBe('"sqrt" needs brackets, like sqrt(2)');
    expect(messageFor('in')).toBe('"in" needs a number in front, like 2in');
    expect(messageFor('10 & 2')).toBe('"&" isn\'t a number, operator or unit');
    expect(messageFor('1.2.3')).toBe('an operator such as + or * is missing before ".3"');
  });

  it('refuses results that are not finite real numbers', () => {
    expect(messageFor('sqrt(-1)')).toBe("the result isn't a real number");
    expect(messageFor('10^400')).toBe('the result is too large');
    expect(messageFor('('.repeat(300))).toBe('it is too long to read');
  });
});
