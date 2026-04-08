/**
 * GRBL Controller — manages serial communication with laser
 * Works in Electron via IPC, with a simulator fallback for browser/testing
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
export type MachineState = 'idle' | 'run' | 'hold' | 'alarm' | 'home' | 'check';

export interface MachineStatus {
  state: MachineState;
  x: number;
  y: number;
  feedRate: number;
  spindleSpeed: number;
  lineNumber: number;
  buffer: number;
}

export interface GrblControllerEvents {
  onConnectionChange: (state: ConnectionState) => void;
  onStatusUpdate: (status: MachineStatus) => void;
  onMessage: (msg: string) => void;
  onError: (err: string) => void;
  onProgress: (linesSent: number, totalLines: number) => void;
  onJobComplete: () => void;
}

export class GrblController {
  private events: GrblControllerEvents;
  private connectionState: ConnectionState = 'disconnected';
  private status: MachineStatus = {
    state: 'idle', x: 0, y: 0,
    feedRate: 0, spindleSpeed: 0, lineNumber: 0, buffer: 15,
  };
  private simulatorMode = true;
  private jobLines: string[] = [];
  private jobIndex = 0;
  private jobRunning = false;
  private statusPollTimer: ReturnType<typeof setInterval> | null = null;
  private portPath: string | null = null;

  constructor(events: GrblControllerEvents) {
    this.events = events;
  }

  /** List available serial ports */
  async listPorts(): Promise<{ path: string; manufacturer?: string }[]> {
    if (window.electronAPI?.listPorts) {
      try {
        return await window.electronAPI.listPorts();
      } catch {
        /* fall through */
      }
    }

    return [
      { path: 'SIMULATOR', manufacturer: 'LaserForge Simulator' },
    ];
  }

  /** Connect to a serial port or simulator */
  async connect(portPath: string, baudRate: number = 115200): Promise<boolean> {
    this.connectionState = 'connecting';
    this.events.onConnectionChange('connecting');

    if (portPath === 'SIMULATOR') {
      this.simulatorMode = true;
      this.portPath = portPath;
      this.connectionState = 'connected';
      this.status.state = 'idle';
      this.events.onConnectionChange('connected');
      this.events.onMessage('LaserForge Simulator connected');
      this.events.onMessage('Grbl 1.1h [\'$\' for help]');
      this.startStatusPolling();
      return true;
    }

    if (window.electronAPI?.connectPort) {
      try {
        const result = await window.electronAPI.connectPort(portPath, baudRate);
        if (result) {
          this.simulatorMode = false;
          this.portPath = portPath;
          this.connectionState = 'connected';
          this.events.onConnectionChange('connected');
          this.startStatusPolling();
          return true;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.onError(`Connection failed: ${msg}`);
      }
    }

    this.connectionState = 'error';
    this.events.onConnectionChange('error');
    return false;
  }

  /** Disconnect */
  async disconnect(): Promise<void> {
    this.stopJob();
    this.stopStatusPolling();

    if (!this.simulatorMode && window.electronAPI?.disconnectPort) {
      await window.electronAPI.disconnectPort();
    }

    this.connectionState = 'disconnected';
    this.portPath = null;
    this.events.onConnectionChange('disconnected');
    this.events.onMessage('Disconnected');
  }

  /** Send a single G-code command */
  async send(command: string): Promise<void> {
    const trimmed = command.trim();
    if (!trimmed) return;

    if (!(trimmed === '?' && !this.simulatorMode)) {
      this.events.onMessage(`> ${trimmed}`);
    }

    if (this.simulatorMode) {
      this.simulateCommand(trimmed);
      return;
    }

    if (window.electronAPI?.sendGcode) {
      await window.electronAPI.sendGcode(trimmed);
    }
  }

  /** Start running a full G-code job */
  async startJob(gcode: string): Promise<void> {
    this.jobLines = gcode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));
    this.jobIndex = 0;
    if (this.jobLines.length === 0) {
      this.events.onMessage('No G-code lines to run.');
      return;
    }
    this.jobRunning = true;
    this.status.state = 'run';
    this.events.onStatusUpdate({ ...this.status });
    this.events.onMessage(`Starting job: ${this.jobLines.length} commands`);

    this.sendNextLine();
  }

  /** Pause the running job */
  pause(): void {
    this.jobRunning = false;
    this.status.state = 'hold';
    this.events.onStatusUpdate({ ...this.status });
    void this.send('!');
  }

  /** Resume a paused job */
  resume(): void {
    this.jobRunning = true;
    this.status.state = 'run';
    this.events.onStatusUpdate({ ...this.status });
    void this.send('~');
    this.sendNextLine();
  }

  /** Stop the running job */
  stopJob(): void {
    this.jobRunning = false;
    this.jobLines = [];
    this.jobIndex = 0;
    this.status.state = 'idle';
    this.events.onStatusUpdate({ ...this.status });
  }

  /** Home the machine */
  async home(): Promise<void> {
    await this.send('$H');
    this.status.x = 0;
    this.status.y = 0;
    this.events.onStatusUpdate({ ...this.status });
  }

  /** Jog the laser head */
  async jog(x: number, y: number, feedRate: number = 1000): Promise<void> {
    await this.send(`$J=G91 X${x} Y${y} F${feedRate}`);
  }

  /** Unlock alarm state */
  async unlock(): Promise<void> {
    await this.send('$X');
    this.status.state = 'idle';
    this.events.onStatusUpdate({ ...this.status });
  }

  /** Fire laser at low power for positioning */
  async laserTest(power: number = 10, durationMs: number = 1000): Promise<void> {
    const s = Math.round((power / 100) * 1000);
    await this.send(`M4 S${s}`);
    setTimeout(() => {
      void this.send('M5 S0');
    }, durationMs);
  }

  getConnectionState(): ConnectionState { return this.connectionState; }
  getStatus(): MachineStatus { return { ...this.status }; }
  isSimulator(): boolean { return this.simulatorMode; }

  private sendNextLine(): void {
    if (!this.jobRunning || this.jobIndex >= this.jobLines.length) {
      if (this.jobIndex >= this.jobLines.length && this.jobLines.length > 0) {
        this.jobRunning = false;
        this.events.onJobComplete();
        this.events.onMessage('Job complete!');
        this.status.state = 'idle';
        this.events.onStatusUpdate({ ...this.status });
      }
      return;
    }

    const line = this.jobLines[this.jobIndex];
    this.jobIndex++;
    this.status.lineNumber = this.jobIndex;
    this.events.onProgress(this.jobIndex, this.jobLines.length);

    if (this.simulatorMode) {
      this.simulateCommand(line);
      const delay = line.startsWith('G0') ? 5 : line.startsWith('G1') ? 10 : 2;
      setTimeout(() => this.sendNextLine(), delay);
    } else {
      void this.sendLineAsync(line);
    }
  }

  private async sendLineAsync(line: string): Promise<void> {
    await this.send(line);
    if (this.jobRunning) this.sendNextLine();
  }

  private simulateCommand(cmd: string): void {
    const xMatch = cmd.match(/X([-\d.]+)/);
    const yMatch = cmd.match(/Y([-\d.]+)/);
    const fMatch = cmd.match(/F([\d.]+)/);
    const sMatch = cmd.match(/S([\d.]+)/);

    if (xMatch) this.status.x = parseFloat(xMatch[1]);
    if (yMatch) this.status.y = parseFloat(yMatch[1]);
    if (fMatch) this.status.feedRate = parseFloat(fMatch[1]);
    if (sMatch) this.status.spindleSpeed = parseFloat(sMatch[1]);

    if (cmd === '$H') {
      this.status.x = 0;
      this.status.y = 0;
      this.events.onMessage('[MSG: Homing complete]');
    }

    if (cmd === '$X') {
      this.events.onMessage('[MSG: Unlocked]');
    }

    if (cmd === '!' || cmd === '~') {
      this.events.onMessage('ok');
      return;
    }

    this.events.onStatusUpdate({ ...this.status });
    this.events.onMessage('ok');
  }

  private startStatusPolling(): void {
    this.stopStatusPolling();
    this.statusPollTimer = setInterval(() => {
      if (this.simulatorMode) {
        this.events.onStatusUpdate({ ...this.status });
      } else {
        void this.send('?');
      }
    }, 250);
  }

  private stopStatusPolling(): void {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
  }
}

declare global {
  interface Window {
    electronAPI?: {
      saveFile?: (defaultName: string, content: string) => Promise<boolean>;
      saveGcode?: (defaultName: string, content: string) => Promise<boolean>;
      openFile?: () => Promise<unknown>;
      isElectron?: boolean;
      listPorts?: () => Promise<{ path: string; manufacturer?: string }[]>;
      connectPort?: (path: string, baudRate: number) => Promise<boolean>;
      disconnectPort?: () => Promise<void>;
      sendGcode?: (cmd: string) => Promise<void>;
    };
  }
}
