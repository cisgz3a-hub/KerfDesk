// Controller settings whose value is a password (controller audit v2 C5-P2-1
// and C4-P3-7; rolling audit v2 27-P2-3 covers the support report).
//
// grblHAL prints a Format_Password setting in plain text in every `$$` reply
// unless a WebUI client is connected (core settings.c setting_get_value). Its
// password settings are core settings.h's $75 Wi-Fi station, $77 access point,
// $330 WebUI admin, $331 WebUI user and $533 MQTT broker. Only the Wi-Fi
// drivers (wifi.c, esp_at.c), the WebUI plugin (login.c) and the Ethernet
// drivers (enet.c) declare a Format_Password setting, and only these five.
// FluidNC names its Wi-Fi passwords `$Sta/Password` and `$AP/Password`, also
// set with `[ESP101]` and `[ESP106]` (WebUI/WifiConfig.cpp).
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.c#L1961-L1962
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.h#L131-L133
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.h#L199-L200
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.h#L372
// https://github.com/bdring/FluidNC/blob/6735500abb71be33c09a3f202d66ad5fc9499063/FluidNC/src/WebUI/WifiConfig.cpp#L691-L702

export const GRBLHAL_PASSWORD_SETTING_IDS: ReadonlyArray<number> = [75, 77, 330, 331, 533];

export const CONTROLLER_PASSWORD_REMOVED = '[password removed]';

export function isGrblhalPasswordSetting(id: number): boolean {
  return GRBLHAL_PASSWORD_SETTING_IDS.includes(id);
}

export const CONTROLLER_PASSWORD_HIDDEN = '[password hidden]';

/** The value a screen shows for setting `id`: a password stays hidden, in the
 *  settings table and in a snapshot saved before snapshots dropped them. Only
 *  an exported backup keeps it, so a restore can write it back. */
export function shownControllerSettingValue(id: number, rawValue: string): string {
  return isGrblhalPasswordSetting(id) && rawValue.trim() !== ''
    ? CONTROLLER_PASSWORD_HIDDEN
    : rawValue;
}

// A value already removed is left alone, so a second pass over text whose line
// breaks were escaped keeps what follows them.
const NOT_REMOVED = String.raw`(?!\[password removed\])`;
// grblHAL reads setting IDs numerically; the Console also accepts padded IDs.
// Ignore horizontal blanks inside that word without masking neighboring IDs.
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/system.c#L1203-L1213
const PASSWORD_SETTING_ID_WORDS = GRBLHAL_PASSWORD_SETTING_IDS.map((id) =>
  String(id)
    .split('')
    .join(String.raw`[ \t]*`),
).join('|');

const PASSWORD_ASSIGNMENTS: ReadonlyArray<RegExp> = [
  new RegExp(
    String.raw`(\$[ \t]*(?:\+[ \t]*)?(?:0[ \t]*)*(?:${PASSWORD_SETTING_ID_WORDS})(?:[ \t]*\.(?:[ \t]*0)*)?[ \t]*=)${NOT_REMOVED}[^\r\n]*`,
    'g',
  ),
  new RegExp(String.raw`(\$[\w/]*password\s*=)${NOT_REMOVED}[^\r\n]*`, 'gi'),
  new RegExp(String.raw`(\[ESP10[16]\])${NOT_REMOVED}[^\r\n]*`, 'gi'),
];

/** Replaces each password assignment's whole value, spaces included, to the
 *  end of its line: `$75=secret` becomes `$75=[password removed]`. */
export function maskControllerPasswords(text: string): string {
  return PASSWORD_ASSIGNMENTS.reduce(
    (current, pattern) => current.replace(pattern, `$1${CONTROLLER_PASSWORD_REMOVED}`),
    text,
  );
}
