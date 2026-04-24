/**
 * Classifies user-typed GRBL console input for pre-send warnings. LaserForge
 * internal commands bypass this and pass source: 'internal' to sendCommand.
 */

export type CommandSeverity = 'safe' | 'warn' | 'dangerous';

export interface CommandClassification {
  severity: CommandSeverity;
  reason: string;
  command: string;
}

/**
 * Classify a user-typed GRBL line. G/M case-insensitive for command words;
 * $-commands compared as sent (GRBL is conventionally uppercase for $).
 */
export function classifyUserCommand(raw: string): CommandClassification {
  const command = raw.trim();
  if (command.length === 0) {
    return { severity: 'safe', reason: '', command: '' };
  }

  if (command === '$X') {
    return {
      severity: 'dangerous',
      command,
      reason:
        'Unlocks the alarm state. Alarms indicate a limit switch hit, soft-limit exceedance, or loss of position. Investigate the cause before unlocking.',
    };
  }

  if (/^\$RST=[*#$]$/i.test(command)) {
    return {
      severity: 'dangerous',
      command,
      reason:
        'Resets firmware EEPROM. This erases machine settings ($130, $$, homing config, etc.) and cannot be undone.',
    };
  }

  if (command === '$SLP') {
    return {
      severity: 'dangerous',
      command,
      reason: 'Enters sleep mode. Controller may become unresponsive until power-cycled.',
    };
  }

  if (/^\$\d+=.+$/.test(command)) {
    return {
      severity: 'warn',
      command,
      reason: `Writes a GRBL setting (${command.split('=')[0]}). Changes persist after reboot and may affect subsequent jobs.`,
    };
  }

  // G10 / G100: G10 is not G100 — require no digit after G10 / G92
  if (/^G10(?![0-9])/i.test(command)) {
    return {
      severity: 'warn',
      command,
      reason:
        'Modifies work coordinate system offsets. This changes where future jobs place themselves.',
    };
  }

  if (/^G92(?![0-9])/i.test(command)) {
    return {
      severity: 'warn',
      command,
      reason:
        "Sets a temporary coordinate offset. This changes the machine's reference frame until reset or power-cycled.",
    };
  }

  // M30 etc. are not M3: require M3/M4 not followed by another digit
  const mHead = command.match(/^[mM]([34])(?![0-9])/i);
  if (mHead) {
    const afterM = command.slice(mHead[0].length);
    // m3S500, M3 S0, m3 s100, or S later on the line (G0 M3 S0)
    const sMatch = afterM.match(/(?:^|\b)S\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/i);
    if (!sMatch) {
      return {
        severity: 'warn',
        command,
        reason:
          'M3/M4 with no S word — the laser will follow the last S value, which can turn the beam on without a known power level.',
      };
    }
    const sVal = parseFloat(sMatch[1] ?? 'NaN');
    if (!Number.isFinite(sVal)) {
      return {
        severity: 'warn',
        command,
        reason: 'M3/M4 with an S value that could not be parsed — the laser may turn on at non-zero power.',
      };
    }
    if (sVal > 0) {
      return {
        severity: 'warn',
        command,
        reason:
          'Turns the laser ON at non-zero power without commanding motion. The beam stays on until you send M5 or M3/M4 with S0.',
      };
    }
  }

  return { severity: 'safe', reason: '', command };
}
