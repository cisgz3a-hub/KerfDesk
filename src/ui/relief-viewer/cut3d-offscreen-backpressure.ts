import type { Cut3DViewportSize } from './cut3d-offscreen-input';
import type {
  Cut3DOffscreenControl,
  Cut3DOffscreenWorkerRequest,
  Cut3DOffscreenWorkerResponse,
} from './cut3d-offscreen-worker-protocol';

const MAX_PENDING_CONTROLS = 4;

/** Keeps control and resize traffic bounded to one in-flight message per stream. */
export class Cut3DOffscreenBackpressure {
  private readonly pendingControls: Cut3DOffscreenControl[] = [];
  private readonly sessionId: number;
  private readonly send: (request: Cut3DOffscreenWorkerRequest) => void;
  private nextInputId = 0;
  private initialPresented = false;
  private controlInFlight: number | null = null;
  private resizeInFlight: number | null = null;
  private pendingResize: Cut3DViewportSize | null = null;

  constructor(sessionId: number, send: (request: Cut3DOffscreenWorkerRequest) => void) {
    this.sessionId = sessionId;
    this.send = send;
  }

  queueControl(control: Cut3DOffscreenControl): void {
    const last = this.pendingControls.at(-1);
    if (last?.kind === control.kind) {
      this.pendingControls[this.pendingControls.length - 1] = mergeControls(last, control);
    } else if (this.pendingControls.length < MAX_PENDING_CONTROLS) {
      this.pendingControls.push(control);
    } else {
      this.pendingControls[MAX_PENDING_CONTROLS - 1] = control;
    }
    this.sendNextControl();
  }

  queueResize(size: Cut3DViewportSize): void {
    this.pendingResize = size;
    this.sendPendingResize();
  }

  get hasInitialPresentation(): boolean {
    return this.initialPresented;
  }

  presented(
    response: Extract<Cut3DOffscreenWorkerResponse, { readonly kind: 'presented' }>,
  ): boolean {
    if (response.source === 'initial') return this.acceptInitial(response.inputId);
    if (!this.initialPresented) return false;
    return response.source === 'control'
      ? this.acceptControl(response.inputId)
      : this.acceptResize(response.inputId);
  }

  private acceptInitial(inputId: number): boolean {
    if (this.initialPresented || inputId !== 0) return false;
    this.initialPresented = true;
    return true;
  }

  private acceptControl(inputId: number): boolean {
    if (inputId !== this.controlInFlight) return false;
    this.controlInFlight = null;
    this.sendNextControl();
    return true;
  }

  private acceptResize(inputId: number): boolean {
    if (inputId !== this.resizeInFlight) return false;
    this.resizeInFlight = null;
    this.sendPendingResize();
    return true;
  }

  private sendNextControl(): void {
    if (this.controlInFlight !== null) return;
    const control = this.pendingControls.shift();
    if (control === undefined) return;
    const inputId = this.nextId();
    this.controlInFlight = inputId;
    this.send({ kind: 'control', sessionId: this.sessionId, inputId, control });
  }

  private sendPendingResize(): void {
    if (this.resizeInFlight !== null || this.pendingResize === null) return;
    const size = this.pendingResize;
    this.pendingResize = null;
    const inputId = this.nextId();
    this.resizeInFlight = inputId;
    this.send({ kind: 'resize', sessionId: this.sessionId, inputId, ...size });
  }

  private nextId(): number {
    this.nextInputId += 1;
    return this.nextInputId;
  }
}

function mergeControls(
  first: Cut3DOffscreenControl,
  second: Cut3DOffscreenControl,
): Cut3DOffscreenControl {
  if (first.kind === 'zoom' && second.kind === 'zoom') {
    return { kind: 'zoom', deltaY: first.deltaY + second.deltaY };
  }
  if (first.kind === 'pan' && second.kind === 'pan') {
    return {
      kind: 'pan',
      deltaX: first.deltaX + second.deltaX,
      deltaY: first.deltaY + second.deltaY,
    };
  }
  if (first.kind === 'rotate' && second.kind === 'rotate') {
    return {
      kind: 'rotate',
      deltaX: first.deltaX + second.deltaX,
      deltaY: first.deltaY + second.deltaY,
    };
  }
  return second;
}
