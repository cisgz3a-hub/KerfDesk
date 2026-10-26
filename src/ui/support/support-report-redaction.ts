// What Help > Save Support Report never copies (ADR-546 item 2, Amendment 2).
//
// grblHAL prints its password settings in plain text in `$$` unless its WebUI
// is connected (core settings.c, Format_Password): $75 Wi-Fi station, $77
// access point, $330 admin, $331 user and $533 MQTT broker (core settings.h).
// FluidNC names them `$Sta/Password` and `$AP/Password`, also set with
// `[ESP101]` and `[ESP106]` (WebUI/WifiConfig.cpp). They reach the report
// through the `$$` rows, the console lines and incident raw text (audit
// 27-P2-3). Sign-ins written into an address (a camera's
// rtsp://user:pass@host) and key=value secrets go the same way.

import { maskControllerPasswords } from '../../core/controllers/controller-password-settings';
import { redactKeyedSecretValues } from './support-report-secret-values';

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bKD\d+\.[\w-]+\.[\w-]+/g, 'KD1.[licence key removed]'],
  // Consume a complete scheme token once, rather than retrying after every
  // hyphen. Up to the authority's last @ removes an unencoded @ in a password.
  [/(?<![a-z\d+.-])([+\d.-]*[a-z][a-z\d+.-]*:\/\/)[^\s/?#]+@/gi, '$1[sign-in removed]@'],
  [/\b(Bearer\s+)[\w.~+/=-]+/gi, '$1[token removed]'],
];

/** Redact raw facts before rendering; never trust marker text supplied by a log. */
export function redactSupportReportText(text: string): string {
  return REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    maskControllerPasswords(redactKeyedSecretValues(text)),
  );
}
