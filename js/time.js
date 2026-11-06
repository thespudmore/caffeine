/** Local wall-clock dates. Day identity is the calendar date, never a 24-hour millisecond step. */

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayIso() {
  return formatDate(new Date());
}

export function isValidDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return formatDate(new Date(y, m - 1, d + days));
}

export function compareIso(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Minutes from local midnight. "24:00" is 1440, the instant the day ends. */
export function parseTime(value) {
  if (value === "24:00") return 1440;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h === 24 && m === 0) return 1440;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function formatTime(minute) {
  const rounded = Math.round(minute);
  if (rounded >= 1440) return "24:00";
  const clamped = Math.max(0, rounded);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function toDate(iso, minute) {
  const [y, m, d] = iso.split("-").map(Number);
  const whole = Math.floor(minute);
  const h = Math.floor(whole / 60);
  const min = whole % 60;
  const sec = Math.round((minute - whole) * 60);
  return new Date(y, m - 1, d, h, min, sec, 0);
}

export function eachDate(startIso, endIso) {
  const dates = [];
  for (let iso = startIso; compareIso(iso, endIso) <= 0; iso = addDays(iso, 1)) {
    dates.push(iso);
  }
  return dates;
}

export function startOfWeek(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  const fromMonday = weekday === 0 ? -6 : 1 - weekday;
  return addDays(iso, fromMonday);
}

export function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function prettyDate(iso) {
  const dt = toDate(iso, 0);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dt);
}

export function shortDate(iso) {
  const dt = toDate(iso, 0);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(dt);
}

export function weekdayShort(iso) {
  const dt = toDate(iso, 0);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(dt);
}

export function weekdayLong(iso) {
  const dt = toDate(iso, 0);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(dt);
}
