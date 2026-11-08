// Days and times, worked out from a clock passed in:
//   clock.now()               milliseconds since 1970, UTC
//   clock.offsetMinutes(ms)   the phone's offset from UTC at that moment, in minutes
// A day is a local date, YYYY-MM-DD. The learner's day starts at 04:00, so a session at
// 01:00 counts for the day before. Times are written with their offset:
// 2026-11-15T07:14:00+03:00. All of it is plain calendar arithmetic, with no Date object.

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export const DAY_BOUNDARY_HOUR = 4;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n, width = 2) => String(n).padStart(width, '0');

// Days since 1970-01-01 for a calendar date, and back (proleptic Gregorian calendar).
export function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const daysInMonth = (year, month) =>
  month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(day) {
  const m = typeof day === 'string' ? DAY.exec(day) : null;
  if (!m) return null;
  const [year, month, date] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || date < 1 || date > daysInMonth(year, month)) return null;
  return { year, month, day: date };
}

// A real calendar date written YYYY-MM-DD.
export const isDay = (day) => parseDay(day) !== null;

const dayOf = ({ year, month, day }) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

const serial = (day) => {
  const p = parseDay(day);
  if (!p) throw new Error(`not a day: ${day}`);
  return daysFromCivil(p.year, p.month, p.day);
};

export const addDays = (day, n) => dayOf(civilFromDays(serial(day) + n));

// Whole days from a to b: positive when b is later.
export const daysBetween = (a, b) => serial(b) - serial(a);

// The local date and time at an instant, for a given offset.
export function localParts(ms, offsetMinutes) {
  const local = ms + offsetMinutes * MS_PER_MINUTE;
  const days = Math.floor(local / MS_PER_DAY);
  const rest = local - days * MS_PER_DAY;
  return {
    ...civilFromDays(days),
    hour: Math.floor(rest / 3_600_000),
    minute: Math.floor((rest % 3_600_000) / MS_PER_MINUTE),
    second: Math.floor((rest % MS_PER_MINUTE) / 1000),
  };
}

// The learner's day now: the local date, with each day starting at the boundary hour.
export function learnerDay(clock, boundaryHour = DAY_BOUNDARY_HOUR) {
  const ms = clock.now();
  const shifted = ms - boundaryHour * 3_600_000;
  return dayOf(localParts(shifted, clock.offsetMinutes(ms)));
}

function offsetText(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const m = Math.abs(minutes);
  return `${sign}${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

// The local time now, with its offset: 2026-11-15T07:14:00+03:00.
export function localStamp(clock) {
  const ms = clock.now();
  const offset = clock.offsetMinutes(ms);
  const p = localParts(ms, offset);
  return `${dayOf(p)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offsetText(offset)}`;
}

const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseStamp(stamp) {
  const m = typeof stamp === 'string' ? STAMP.exec(stamp) : null;
  if (!m || !isDay(m[1])) return null;
  const [hour, minute, second] = [Number(m[2]), Number(m[3]), Number(m[4] || 0)];
  if (hour > 23 || minute > 59 || second > 59) return null;
  const offset = m[5] === 'Z' ? 0 : (m[6] === '-' ? -1 : 1) * (Number(m[7]) * 60 + Number(m[8]));
  return { day: m[1], hour, minute, second, offset };
}

// A time written with its offset.
export const isStamp = (stamp) => parseStamp(stamp) !== null;

// The instant a stamp names, in milliseconds since 1970, or NaN.
export function instantOf(stamp) {
  const p = parseStamp(stamp);
  if (!p) return Number.NaN;
  const local = serial(p.day) * MS_PER_DAY + ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
  return local - p.offset * MS_PER_MINUTE;
}

// The local date and time a stamp shows: "2026-11-15 07:14".
export function stampText(stamp) {
  const p = parseStamp(stamp);
  return p ? `${p.day} ${pad(p.hour)}:${pad(p.minute)}` : '';
}

// The local date a stamp shows, YYYY-MM-DD.
export function stampDay(stamp) {
  const p = parseStamp(stamp);
  return p ? p.day : '';
}

// A day written out: "15 November 2026".
export function longDate(day) {
  const p = parseDay(day);
  return p ? `${p.day} ${MONTHS[p.month - 1]} ${p.year}` : '';
}
