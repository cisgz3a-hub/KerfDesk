import { type LaserController } from '../controllers/ControllerInterface';
import {
  classifyUserCommand as classifyUserGrbl,
  type CommandClassification,
  type CommandSeverity,
} from '../controllers/grbl/CommandClassifier';

export type MachineCommandGatewayController = Pick<LaserController, 'sendCommand' | 'safetyOff'>;
export type MachineCommandGatewayAxis = 'X' | 'Y';

export type LaserOffResult = Awaited<ReturnType<LaserController['safetyOff']>>;
export type MachineCommandResult = { ok: true } | { ok: false; reason: string };
export type ApprovalBlockReason = 'no-token' | 'token-mismatch' | 'token-expired' | 'token-replayed';

export interface ApprovalToken {
  command: string;
  expiresAt: number;
  nonce: string;
  issuedAt?: number;
  classification?: CommandSeverity;
}

export interface MachineCommandApprovalState {
  consumedApprovalNonces: Map<string, number>;
  pruneConsumedApprovalNonces(now: number): void;
  now?: () => number;
}

/**
 * T2-10 pass 1: a single command choke point that preserves existing behavior.
 * Policy checks land after call sites migrate through this wrapper.
 */
export class MachineCommandGateway {
  constructor(private readonly controller: MachineCommandGatewayController) {}

  private blockUserCommand(
    classification: CommandClassification,
    blockReason: ApprovalBlockReason,
  ): never {
    const reasonByBlock: Record<ApprovalBlockReason, string> = {
      'no-token': 'approval token is required',
      'token-mismatch': 'approval token does not match this command',
      'token-expired': 'approval token has expired',
      'token-replayed': 'approval token has already been used',
    };
    const err = new Error(
      `Command blocked: ${classification.severity} command ${reasonByBlock[blockReason]}. ${classification.reason}`,
    ) as Error & {
      code: 'COMMAND_BLOCKED';
      severity: CommandSeverity;
      reason: string;
      command: string;
      blockReason: ApprovalBlockReason;
    };
    err.code = 'COMMAND_BLOCKED';
    err.severity = classification.severity;
    err.reason = classification.reason;
    err.command = classification.command;
    err.blockReason = blockReason;
    throw err;
  }

  sendCommand(
    command: string,
    source: 'internal' | 'user' = 'internal',
    approvalToken?: ApprovalToken,
    approvalState?: MachineCommandApprovalState,
  ): void {
    if (source === 'user') {
      const classification = classifyUserGrbl(command);
      if (classification.severity !== 'safe') {
        const now = approvalState?.now?.() ?? Date.now();
        approvalState?.pruneConsumedApprovalNonces(now);

        if (!approvalState || !approvalToken) {
          this.blockUserCommand(classification, 'no-token');
        }
        if (
          approvalToken.command !== classification.command
          || typeof approvalToken.nonce !== 'string'
          || approvalToken.nonce.length === 0
          || (approvalToken.classification != null && approvalToken.classification !== classification.severity)
        ) {
          this.blockUserCommand(classification, 'token-mismatch');
        }
        if (approvalState.consumedApprovalNonces.has(approvalToken.nonce)) {
          this.blockUserCommand(classification, 'token-replayed');
        }
        if (!Number.isFinite(approvalToken.expiresAt) || now > approvalToken.expiresAt) {
          this.blockUserCommand(classification, 'token-expired');
        }
        approvalState.consumedApprovalNonces.set(approvalToken.nonce, approvalToken.expiresAt);
        approvalState.pruneConsumedApprovalNonces(now);
      }
    }
    this.controller.sendCommand(command, source);
  }

  sendInternalCommand(command: string): void {
    this.sendCommand(command, 'internal');
  }

  unlock(): void {
    this.sendInternalCommand('$X');
  }

  home(): void {
    this.sendInternalCommand('$H');
  }

  setOriginAtCurrentPosition(): void {
    this.sendInternalCommand('G10 L20 P1 X0 Y0');
  }

  resetWcsToMachineOrigin(): void {
    this.sendInternalCommand('G10 L2 P1 X0 Y0 Z0');
  }

  trySetOriginAtCurrentPosition(): MachineCommandResult {
    try {
      this.setOriginAtCurrentPosition();
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  tryResetWcsToMachineOrigin(): MachineCommandResult {
    try {
      this.resetWcsToMachineOrigin();
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  jog(axis: MachineCommandGatewayAxis, distanceMm: number, feedRateMmPerMinute: number): void {
    this.sendInternalCommand(`$J=G91 G21 ${axis}${distanceMm} F${feedRateMmPerMinute}`);
  }

  laserOff(): Promise<LaserOffResult> {
    return this.controller.safetyOff();
  }
}
