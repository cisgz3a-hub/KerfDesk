import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import {
  adapterForCapture,
  beginCaptureTest,
  captureAdapter,
  captureController,
  CAPTURE_IDLE,
  CAPTURE_PROGRAM,
  connectCaptureController,
  endCaptureTest,
} from '../../__fixtures__/controller-incident-capture';
import { incidentHistory, INCIDENT_AT } from '../../__fixtures__/controller-incidents';
import { useLaserStore } from './laser-store';
import { flushConnect } from './laser-store-console.test-support';
import { settleTestGrblHandshake } from './laser-test-start-helpers';
import { controllerIncidentContext } from './controller-incident-context';
import { gatherSupportReportFacts } from '../support/save-support-report';
import { formatSupportReport } from '../support/support-report';

describe('D1 immutable event-time controller and run facts', () => {
  beforeEach(beginCaptureTest);
  afterEach(endCaptureTest);

  it('captures an unexpected close before controller/run teardown, with no executable bytes', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    const before = useLaserStore.getState();
    if (before.statusReport === null) throw new Error('Expected the qualified controller status.');
    const firmware = ['[VER:old-controller]', '[OPT:V,15,128]'];
    const position = { x: 12, y: 34, z: -5 };
    const usb = { usbVendorId: 1234, usbProductId: 5678 };
    useLaserStore.setState({
      serialPortInfo: usb,
      controllerBuildInfoRawLines: firmware,
      statusReport: { ...before.statusReport, state: 'Run', mPos: position },
      activeRunId: 'D1-old-run',
      activeJobMachineKind: 'laser',
      streamerEpoch: 72,
      streamer: {
        ...createStreamer(CAPTURE_PROGRAM),
        status: 'streaming',
        completed: 3,
        queueIndex: 5,
      },
    });
    const closedAt = Date.now();
    controller.emitClose();
    const entry = incidentHistory().find((item) => item.kind === 'disconnect');
    expect(entry).toBeDefined();
    if (entry === undefined || entry.incidentContext === undefined)
      throw new Error('Expected the captured disconnect context.');
    const context = entry.incidentContext;
    expect(entry.at).toBe(closedAt);
    expect(context).toMatchObject({
      controller: {
        sessionEpoch: before.controllerSessionEpoch,
        selectedKind: 'grbl-v1.1',
        connection: 'connected',
        baudRate: 115200,
        usb,
        status: 'Run',
        machinePosition: position,
        firmwareLines: firmware,
      },
      run: {
        id: 'D1-old-run',
        machineKind: 'laser',
        streamerEpoch: 72,
        status: 'streaming',
        completed: 3,
        total: 34,
        queueIndex: 5,
      },
    });
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().streamer?.status).toBe('disconnected');
    firmware[0] = '[VER:mutated-live-array]';
    position.x = 999;
    usb.usbVendorId = 999;
    expect(context.controller.firmwareLines[0]).toBe('[VER:old-controller]');
    expect(context.controller.machinePosition?.x).toBe(12);
    expect(context.controller.usb?.usbVendorId).toBe(1234);
    const encoded = JSON.stringify(context);
    expect(encoded).not.toContain('G1 X');
    expect(encoded).not.toContain('M4 S0');
    expect(encoded).not.toContain('queued');
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.controller.machinePosition)).toBe(true);
  });

  it('keeps UART event facts and reports their original controller separately after reconnect', async () => {
    const first = captureController();
    await connectCaptureController(first.connection);
    const epoch = useLaserStore.getState().controllerSessionEpoch;
    useLaserStore.setState({
      controllerBuildInfoRawLines: ['[VER:original-firmware]'],
      activeRunId: 'D1-first-run',
    });
    first.emitLineError('FramingError');
    const old = incidentHistory().find((entry) => entry.raw.includes('FramingError'));
    expect(old?.kind).toBe('message');
    expect(old?.incidentContext).toMatchObject({
      controller: {
        sessionEpoch: epoch,
        baudRate: 115200,
        firmwareLines: ['[VER:original-firmware]'],
      },
      run: { id: 'D1-first-run' },
    });
    if (old === undefined) throw new Error('Expected the original UART incident.');
    const next = captureController();
    await connectAtBaud(next.connection, 57600);
    useLaserStore.setState({
      controllerBuildInfoRawLines: ['[VER:new-firmware]'],
      activeRunId: 'D1-second-run',
    });
    next.connection.emitLine('error:20');
    const newer = incidentHistory().find((entry) => entry.raw === 'error:20');
    expect(newer?.id).toBeGreaterThan(old.id);
    expect(newer?.incidentContext?.controller.baudRate).toBe(57600);
    expect(incidentHistory()).toContainEqual(old);
    const facts = await gatherSupportReportFacts(
      adapterForCapture(next.connection),
      new Date(INCIDENT_AT + 60000),
    );
    const report = formatSupportReport(facts);
    expect(report).toContain('== Retained controller incidents, newest last ==');
    expect(report).toContain('Event-time context (captured when this incident occurred):');
    expect(report).toContain('session ' + epoch + ', baud 115200');
    expect(report).toContain('Firmware: [VER:original-firmware]');
    expect(report).toContain('Run: D1-first-run');
    expect(report).toContain('Firmware: [VER:new-firmware]');
    expect(facts.controllerIncidents?.find((entry) => entry.id === old?.id)).toEqual(old);
  });

  it('freezes report event evidence before an asynchronous desktop-log read finishes', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    controller.connection.emitLine('error:20');
    const old = incidentHistory().find((entry) => entry.raw === 'error:20');
    let resolveLog: (text: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => {
      resolveLog = resolve;
    });
    const adapter: PlatformAdapter = {
      ...adapterForCapture(controller.connection),
      readSupportLog: async () => pending,
    };
    const saving = gatherSupportReportFacts(adapter, new Date(INCIDENT_AT));
    useLaserStore.setState({
      controllerSessionEpoch: 999,
      connectedBaudRate: 9600,
      activeRunId: 'later-run',
      controllerBuildInfoRawLines: ['later'],
    });
    useLaserStore.getState().clearIncidentHistory();
    resolveLog('later desktop log');
    const saved = await saving;
    expect(saved.controllerIncidents).toContainEqual(old);
    expect(saved.controllerIncidents?.[0]?.incidentContext?.controller.sessionEpoch).not.toBe(999);
    expect(saved.controllerIncidents?.[0]?.incidentContext?.run.id).not.toBe('later-run');
    expect(incidentHistory()).toEqual([]);
  });

  it('bounds firmware/context strings and excludes invalid numeric observations', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    const before = useLaserStore.getState();
    if (before.statusReport === null) throw new Error('Expected the qualified controller status.');
    const context = controllerIncidentContext({
      ...before,
      connectedBaudRate: Infinity,
      controllerBuildInfoRawLines: Array.from({ length: 50 }, () => 'f'.repeat(5000)),
      statusReport: { ...before.statusReport, mPos: { x: NaN, y: 3, z: 4 } },
      statusObservation: { sessionEpoch: 1, positionEpoch: 1, sequence: 1, observedAt: Infinity },
      pendingTransportWrites: NaN,
      activeRunId: 'r'.repeat(5000),
    });
    expect(context?.controller.firmwareLines).toHaveLength(8);
    expect(context?.controller.firmwareLines.every((line) => line.length <= 512)).toBe(true);
    expect(context?.controller.baudRate).toBeNull();
    expect(context?.controller.machinePosition).toBeNull();
    expect(context?.controller.statusObservedAt).toBeNull();
    expect(context?.run.pendingTransportWrites).toBe(0);
    expect(context?.run.id?.length).toBeLessThanOrEqual(512);
    expect(JSON.stringify(context)).not.toContain('Infinity');
    expect(JSON.stringify(context)).not.toContain('NaN');
  });

  it('retains a replacement-close rejection once with the old owner, ignoring retired callbacks', async () => {
    const first = captureController();
    await connectCaptureController(first.connection);
    let closingEpoch = -1;
    const oldUart = first.retiredErrors[0];
    vi.spyOn(first.connection, 'close').mockImplementation(async () => {
      closingEpoch = useLaserStore.getState().controllerSessionEpoch;
      throw new Error('D1 replacement close rejected');
    });
    const next = captureController();
    await connectAtBaud(next.connection, 57600);
    const retained = incidentHistory().filter((entry) =>
      entry.raw.includes('D1 replacement close rejected'),
    );
    expect(retained).toHaveLength(1);
    expect(retained[0]?.kind).toBe('disconnect');
    expect(retained[0]?.incidentContext?.controller).toMatchObject({
      sessionEpoch: closingEpoch,
      connection: 'connected',
      baudRate: 115200,
    });
    expect(useLaserStore.getState().controllerSessionEpoch).toBeGreaterThan(closingEpoch);
    const before = useLaserStore.getState();
    oldUart?.('D1 old callback after rejected close');
    first.connection.emitLine('error:20');
    first.emitClose();
    expect(useLaserStore.getState()).toBe(before);
    expect(
      incidentHistory().filter((entry) => entry.raw.includes('D1 replacement close rejected')),
    ).toEqual(retained);
    expect(incidentHistory().some((entry) => entry.raw.includes('D1 old callback'))).toBe(false);
    expect(next.closeCount()).toBe(0);
  });

  it('redacts context keys before JSON or delimiter escaping can hide word boundaries', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    useLaserStore.setState({
      controllerQualification: {
        kind: 'failed',
        epoch: useLaserStore.getState().controllerSessionEpoch,
        message: 'fault\tKD1.context-qualification.secret\nnote',
      },
      activeRunId: 'run\tKD1.context-run.secret\nlater',
      controllerBuildInfoRawLines: ['firmware\tKD1.context-firmware.secret\ninfo'],
    });
    controller.connection.emitLine('error:20');
    const facts = await gatherSupportReportFacts(
      adapterForCapture(controller.connection),
      new Date(INCIDENT_AT),
    );
    const report = formatSupportReport(facts);
    expect(report).not.toContain('KD1.context-qualification.secret');
    expect(report).not.toContain('KD1.context-run.secret');
    expect(report).not.toContain('KD1.context-firmware.secret');
    expect(report).toContain('fault\\tKD1.[licence key removed]\\nnote');
    expect(report).toContain('Run: run\\tKD1.[licence key removed]\\nlater');
    expect(report).toContain('firmware\\tKD1.[licence key removed]\\ninfo');
  });

  it('control: a synchronous intentional onClose does not add an unexpected disconnect', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    vi.spyOn(controller.connection, 'close').mockImplementation(async () => controller.emitClose());
    await useLaserStore.getState().disconnect();
    expect(incidentHistory()).toEqual([]);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it('control: picker cancellation leaves existing retained context intact without adding a fault', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    controller.emitLineError('ParityError');
    const before = incidentHistory();
    await useLaserStore.getState().connect(
      captureAdapter(async () => null),
      { portSelection: 'choose' },
    );
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(incidentHistory()).toEqual(before);
  });
});

async function connectAtBaud(
  connection: ReturnType<typeof captureController>['connection'],
  baudRate: number,
): Promise<void> {
  await useLaserStore.getState().connect(adapterForCapture(connection), { baudRate });
  connection.emitLine('Grbl 1.1f');
  connection.emitLine(CAPTURE_IDLE);
  await flushConnect();
  for (const line of ['$13=0', '$30=1000', '$32=1', 'ok']) connection.emitLine(line);
  await settleTestGrblHandshake();
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
}
