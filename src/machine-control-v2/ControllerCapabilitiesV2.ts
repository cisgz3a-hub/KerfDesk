export interface ControllerCapabilitiesV2 {
  readonly canStart: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canStop: boolean;
  readonly canEmergencyStop: boolean;
  readonly canJog: boolean;
  readonly canHome: boolean;
  readonly canUnlock: boolean;
  readonly canResetWcs: boolean;
  readonly canTestFire: boolean;
  readonly canFrame: boolean;
}
