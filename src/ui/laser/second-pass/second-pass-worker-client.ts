import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import type { PreparedStartProgram } from '../../state/framed-run';
import type { ExecutionArtifactV1 } from '../../state/recovery';
import type { SecondPassDrawing } from './second-pass-preview';
import {
  captureLaserSecondPassSource,
  laserSecondPassSourceMatches,
  registerVerifiedLaserSecondPassPreparation,
  type LaserSecondPassFrameGeometry,
  type LaserSecondPassSourceSnapshot,
} from '../second-pass-preparation-proof';

export type SecondPassPreview = {
  prepared: PreparedStartProgram;
  drawing: SecondPassDrawing;
  burnLengthMm: number;
};

/** One owner per workbench. Closing it terminates expensive verification/compilation. */
export class SecondPassWorkerClient {
  private readonly worker = new Worker(new URL('./second-pass-worker.ts', import.meta.url), {
    type: 'module',
  });
  private nextId = 0;
  private closed = false;
  private openVersion = 0;
  private verifiedSource: ExecutionArtifactV1 | null = null;
  private sourceSnapshot: LaserSecondPassSourceSnapshot | null = null;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; value?: unknown; error?: string }>,
    ) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.value);
    };
    this.worker.onerror = () =>
      this.close('The second-pass preview worker stopped. Reopen the saved job to try again.');
    this.worker.onmessageerror = () =>
      this.close('The second-pass preview could not be read. Reopen the saved job to try again.');
  }
  async open(source: ExecutionArtifactV1): Promise<SecondPassDrawing> {
    const version = ++this.openVersion;
    const snapshot = captureLaserSecondPassSource(source);
    this.verifiedSource = null;
    this.sourceSnapshot = null;
    const drawing = (await this.request({ source })) as SecondPassDrawing;
    if (this.closed) throw new Error('Second-pass preview closed.');
    if (version !== this.openVersion || !laserSecondPassSourceMatches(snapshot, source))
      throw new Error('The saved source changed while it was being verified. Reopen its preview.');
    this.verifiedSource = source;
    this.sourceSnapshot = snapshot;
    return drawing;
  }
  async compile(selection: LaserSecondPassSelection): Promise<SecondPassPreview> {
    if (this.closed) throw new Error('Second-pass preview is closed.');
    const frozen = structuredClone(selection);
    const source = this.verifiedSource;
    const snapshot = this.sourceSnapshot;
    if (source === null || snapshot === null)
      throw new Error('Open a saved laser job before preparing a second pass.');
    this.assertSourceCurrent(source, snapshot);
    const result = (await this.request({ selection: frozen })) as SecondPassPreview;
    this.assertSourceCurrent(source, snapshot);
    registerVerifiedLaserSecondPassPreparation(
      source,
      result.prepared,
      frozen,
      async (initialPosition) => {
        this.assertSourceCurrent(source, snapshot);
        const geometry = (await this.request({
          gcode: result.prepared.gcode,
          initialPosition,
        })) as LaserSecondPassFrameGeometry;
        this.assertSourceCurrent(source, snapshot);
        return geometry;
      },
    );
    return result;
  }
  close(reason = 'Second-pass preview closed.'): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error(reason));
    this.pending.clear();
  }
  private assertSourceCurrent(
    source: ExecutionArtifactV1,
    snapshot: LaserSecondPassSourceSnapshot,
  ): void {
    if (
      this.closed ||
      this.verifiedSource !== source ||
      this.sourceSnapshot !== snapshot ||
      !laserSecondPassSourceMatches(snapshot, source)
    )
      throw new Error('The saved source changed. Reopen the second-pass preview.');
  }
  private request(payload: {
    source?: ExecutionArtifactV1;
    selection?: LaserSecondPassSelection;
    gcode?: string;
    initialPosition?: { x: number; y: number; z: number };
  }): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Second-pass preview is closed.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, ...payload });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
