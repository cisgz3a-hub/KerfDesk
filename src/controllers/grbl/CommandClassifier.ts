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
  const code = stripGcodeComments(command);
  const words = parseGcodeWords(code);

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
  if (words.some(word => word.letter === 'G' && word.value === '10')) {
    return {
      severity: 'warn',
      command,
      reason:
        'Modifies work coordinate system offsets. This changes where future jobs place themselves.',
    };
  }

  if (words.some(word => word.letter === 'G' && word.value === '92')) {
    return {
      severity: 'warn',
      command,
      reason:
        "Sets a temporary coordinate offset. This changes the machine's reference frame until reset or power-cycled.",
    };
  }

  // M30 etc. are not M3: parse M3/M4 as command words anywhere in the block.
  const laserOnWordIndex = words.findIndex(word => word.letter === 'M' && (word.value === '3' || word.value === '4'));
  if (laserOnWordIndex >= 0) {
    const sWord = words.slice(laserOnWordIndex + 1).find(word => word.letter === 'S');
    if (!sWord) {
      return {
        severity: 'warn',
        command,
        reason:
          'M3/M4 with no S word — the laser will follow the last S value, which can turn the beam on without a known power level.',
      };
    }
    const sVal = parseFloat(sWord.value);
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

interface GcodeWord {
  readonly letter: string;
  readonly value: string;
}

function stripGcodeComments(command: string): string {
  return command
    .replace(/\([^)]*\)/g, ' ')
    .replace(/;.*$/, ' ');
}

function parseGcodeWords(command: string): GcodeWord[] {
  const words: GcodeWord[] = [];
  const wordRe = /([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(command)) !== null) {
    words.push({
      letter: (match[1] ?? '').toUpperCase(),
      value: match[2] ?? '',
    });
  }
  return words;
}
