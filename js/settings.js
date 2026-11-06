import { parseTime } from "./time.js";

export const DEFAULT_SETTINGS = {
  half_life_h: 4,
  absorption_mode: "first-order",
  tmax_h: 0.75,
  history_days: 7,
  recency_decay: 0.8,
  smoothing_sigma_min: 30,
  bedtime: "23:00",
  window_start: "06:00",
  window_end: "24:00",
  carry_overnight: true,
};

/** Spreadsheet prototype: instant absorption, flat-day restart, two-day memory. */
export const PROTOTYPE_SETTINGS = {
  half_life_h: 4,
  absorption_mode: "instant",
  tmax_h: 0.75,
  history_days: 2,
  recency_decay: 0.5,
  smoothing_sigma_min: 0,
  bedtime: "23:00",
  window_start: "06:00",
  window_end: "21:00",
  carry_overnight: false,
};

function clamp(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function timeOr(value, fallback) {
  return parseTime(value) == null ? fallback : value;
}

export function normalizeSettings(input = {}) {
  const mode = input.absorption_mode === "instant" ? "instant" : input.absorption_mode === "first-order" ? "first-order" : DEFAULT_SETTINGS.absorption_mode;
  let windowStart = timeOr(input.window_start, DEFAULT_SETTINGS.window_start);
  let windowEnd = timeOr(input.window_end, DEFAULT_SETTINGS.window_end);
  if (parseTime(windowEnd) <= parseTime(windowStart)) {
    windowStart = DEFAULT_SETTINGS.window_start;
    windowEnd = DEFAULT_SETTINGS.window_end;
  }
  return {
    half_life_h: clamp(input.half_life_h, DEFAULT_SETTINGS.half_life_h, 2, 10),
    absorption_mode: mode,
    tmax_h: clamp(input.tmax_h, DEFAULT_SETTINGS.tmax_h, 0.25, 2),
    history_days: Math.round(clamp(input.history_days, DEFAULT_SETTINGS.history_days, 1, 21)),
    recency_decay: clamp(input.recency_decay, DEFAULT_SETTINGS.recency_decay, 0.3, 1),
    smoothing_sigma_min: Math.round(clamp(input.smoothing_sigma_min, DEFAULT_SETTINGS.smoothing_sigma_min, 0, 120)),
    bedtime: timeOr(input.bedtime, DEFAULT_SETTINGS.bedtime),
    window_start: windowStart,
    window_end: windowEnd,
    carry_overnight: input.carry_overnight == null ? DEFAULT_SETTINGS.carry_overnight : Boolean(input.carry_overnight),
  };
}
