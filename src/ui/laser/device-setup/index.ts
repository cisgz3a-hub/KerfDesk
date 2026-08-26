// Public setup surface: rail controls open one App-level dialog host, while
// other UI can deep-link to an exact CNC Startup Setup field.
export { DeviceSetupControls } from './DeviceSetupControls';
export { MachineSetupDialogHost } from './MachineSetupDialogHost';
export {
  closeMachineSetup,
  openMachineSetup,
  type CncStartupSetupField,
  type MachineSetupTarget,
} from './machine-setup-dialog-store';
