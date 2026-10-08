import { afterEach, expect, it } from 'vitest';
import { connectWith, makeConnection, flushConnect } from './laser-store-console-harness';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
});

it('owns one query and captures a current-session report without settings writes or capability enabling', async () => {
  const writes: string[] = [];
  const connection = makeConnection(async (data) => {
    writes.push(data);
  });
  await connectWith(connection);
  writes.length = 0;
  const capabilities = useLaserStore.getState().capabilities;
  const reading = useLaserStore.getState().readFirmwareReport();
  await flushConnect();
  expect(writes).toEqual(['$I\n']);
  connection.emitLine('[VER:1.1h.20190830:PRIVATE]');
  connection.emitLine('[OPT:VM,15,128]');
  connection.emitLine('ok');
  const report = await reading;
  expect(report.sessionEpoch).toBe(useLaserStore.getState().controllerSessionEpoch);
  expect(report.fields).toContainEqual({ name: 'Version', value: '1.1h.20190830' });
  expect(JSON.stringify(report)).not.toContain('PRIVATE');
  expect(useLaserStore.getState().capabilities).toBe(capabilities);
  expect(useLaserStore.getState().controllerOperation).toBeNull();
});

it('refuses busy transport before querying and cleans up a rejected owned query', async () => {
  const writes: string[] = [];
  const connection = makeConnection(async (data) => {
    writes.push(data);
  });
  await connectWith(connection);
  writes.length = 0;
  useLaserStore.setState({ pendingTransportWrites: 1 });
  await expect(useLaserStore.getState().readFirmwareReport()).rejects.toThrow('previous');
  expect(writes).toEqual([]);
  useLaserStore.setState({ pendingTransportWrites: 0 });
  const reading = useLaserStore.getState().readFirmwareReport();
  const rejected = expect(reading).rejects.toThrow('error:3');
  await flushConnect();
  connection.emitLine('error:3');
  await rejected;
  expect(useLaserStore.getState().controllerFirmwareReport).toBeNull();
  expect(useLaserStore.getState().controllerOperation).toBeNull();
});

it('does not publish an identity when the session changes before the terminal reply', async () => {
  const connection = makeConnection(async () => undefined);
  await connectWith(connection);
  const reading = useLaserStore.getState().readFirmwareReport();
  const rejected = expect(reading).rejects.toThrow('obsolete');
  await flushConnect();
  useLaserStore.setState((state) => ({ controllerSessionEpoch: state.controllerSessionEpoch + 1 }));
  connection.emitLine('[VER:1.1h.20190830:]');
  connection.emitLine('ok');
  await rejected;
  expect(useLaserStore.getState().controllerFirmwareReport).toBeNull();
});
