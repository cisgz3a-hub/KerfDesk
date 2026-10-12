// Custom date and time formats for variable text (LightBurn's Date/Time
// formatting codes, the familiar strftime set). Fields use the computer's
// local time, like the fixed formats. An unknown code is kept as typed, so a
// typo shows on the preview instead of vanishing.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const MAX_DATE_PATTERN_LENGTH = 200;

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function dayOfYear(date: Date): number {
  const year = date.getFullYear();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const before = MONTH_DAYS.slice(0, date.getMonth()).reduce((sum, days) => sum + days, 0);
  return before + (leap && date.getMonth() > 1 ? 1 : 0) + date.getDate();
}

const CODES: Readonly<Record<string, (date: Date) => string>> = {
  Y: (date) => pad(date.getFullYear(), 4),
  y: (date) => pad(date.getFullYear() % 100),
  m: (date) => pad(date.getMonth() + 1),
  d: (date) => pad(date.getDate()),
  e: (date) => String(date.getDate()),
  H: (date) => pad(date.getHours()),
  I: (date) => pad(((date.getHours() + 11) % 12) + 1),
  M: (date) => pad(date.getMinutes()),
  S: (date) => pad(date.getSeconds()),
  p: (date) => (date.getHours() < 12 ? 'AM' : 'PM'),
  b: (date) => (MONTHS[date.getMonth()] ?? '').slice(0, 3),
  B: (date) => MONTHS[date.getMonth()] ?? '',
  a: (date) => (DAYS[date.getDay()] ?? '').slice(0, 3),
  A: (date) => DAYS[date.getDay()] ?? '',
  j: (date) => pad(dayOfYear(date), 3),
  '%': () => '%',
};

export function formatDatePattern(date: Date, pattern: string): string {
  return pattern.replace(/%(.)/g, (whole, code: string) => CODES[code]?.(date) ?? whole);
}
