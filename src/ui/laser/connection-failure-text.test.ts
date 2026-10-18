import { describe, expect, it } from 'vitest';
import { connectionFailureText } from './ConnectionBar';

const OPEN_FAILED = "Failed to execute 'open' on 'SerialPort': Failed to open serial port.";

describe('why a serial port did not open', () => {
  it('names a busy port everywhere', () => {
    const text = connectionFailureText(OPEN_FAILED, 'laser', false);
    expect(text).toContain('The port is busy or unavailable');
    expect(text).not.toContain('dialout');
  });

  it('adds the serial group step on Linux, where a missing group looks the same (ADR-607)', () => {
    const text = connectionFailureText(OPEN_FAILED, 'laser', true);
    expect(text).toContain('The port is busy or unavailable');
    expect(text).toContain('sudo usermod -aG dialout $USER');
    expect(text).toContain('log out and back in');
  });

  it('passes any other error through unchanged', () => {
    expect(connectionFailureText('Controller did not answer.', 'laser', true)).toBe(
      'Controller did not answer.',
    );
  });
});
