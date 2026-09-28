// The AppCommandContext slice for Edit → Settings (LightBurn gap LBG-F18),
// kept in its own file so command-types.ts stays inside the size cap.

export type SettingsCommandContext = {
  readonly openSettings: () => void;
};

export type SettingsCommandId = 'edit.settings';
