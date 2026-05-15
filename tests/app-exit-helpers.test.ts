import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildExitFlowPlan,
  isExitConnectedStatus,
} from '../src/ui/components/app/appExitHelpers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();

console.log('\n=== T2-6 Phase 3al app exit helpers ===\n');

assert(!isExitConnectedStatus(null), 'null status is not connected for exit');
assert(!isExitConnectedStatus('disconnected'), 'disconnected status is not connected for exit');
assert(!isExitConnectedStatus('connecting'), 'connecting status is not connected for exit');
assert(isExitConnectedStatus('idle'), 'idle status is connected for exit');
assert(isExitConnectedStatus('running'), 'running status is connected for exit');

assert(
  buildExitFlowPlan({
    machineStatus: 'running',
    hasController: true,
    controllerJobRunning: true,
    sceneDirty: true,
    electronQuitAvailable: true,
  }).promptRunningJob,
  'running connected controller prompts before exit',
);

const disconnectedDirtyPlan = buildExitFlowPlan({
  machineStatus: 'disconnected',
  hasController: false,
  controllerJobRunning: true,
  sceneDirty: true,
  electronQuitAvailable: false,
});
assert(!disconnectedDirtyPlan.shouldDisconnect, 'disconnected exit does not request safe disconnect');
assert(!disconnectedDirtyPlan.promptRunningJob, 'disconnected exit does not prompt for controller job state');
assert(disconnectedDirtyPlan.promptUnsavedChanges, 'dirty disconnected exit still prompts for unsaved changes');
assert(disconnectedDirtyPlan.destination === 'landing', 'browser exit falls back to landing page');

const electronCleanPlan = buildExitFlowPlan({
  machineStatus: 'idle',
  hasController: true,
  controllerJobRunning: false,
  sceneDirty: false,
  electronQuitAvailable: true,
});
assert(electronCleanPlan.shouldDisconnect, 'connected clean exit requests safe disconnect');
assert(!electronCleanPlan.promptUnsavedChanges, 'clean exit skips unsaved prompt');
assert(electronCleanPlan.destination === 'electron-quit', 'Electron exit uses quit API');

const appSource = readFileSync(resolve(root, 'src/ui/components/App.tsx'), 'utf8');
const helperSource = readFileSync(resolve(root, 'src/ui/components/app/appExitHelpers.ts'), 'utf8');

assert(appSource.includes('buildExitFlowPlan'), 'App delegates exit policy to buildExitFlowPlan');
assert(!appSource.includes("status !== 'disconnected' && status !== 'connecting'"),
  'App no longer carries connected-status policy inline');
assert(helperSource.includes('T2-6 Phase 3al'), 'appExitHelpers carries the T2-6 Phase 3al marker');

console.log('Exit flow decisions are extracted from App.');
