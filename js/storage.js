import { isValidDate, parseTime } from "./time.js";
import { normalizeSettings } from "./settings.js";

const DATA_KEY = "caffeine-energy-tracker-v1";
const UI_KEY = "caffeine-energy-tracker-ui";

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `dose-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeDose(dose) {
  if (!dose || !isValidDate(dose.date) || parseTime(dose.time) == null) return null;
  const amount = Number(dose.amount_mg);
  if (!(amount > 0)) return null;
  const time = dose.time.length === 4 ? `0${dose.time}` : dose.time;
  return {
    id: typeof dose.id === "string" && dose.id ? dose.id : uid(),
    date: dose.date,
    time,
    amount_mg: amount,
    label: dose.label ? String(dose.label) : "",
    preset_id: dose.preset_id ? String(dose.preset_id) : "",
    duration_min: Number(dose.duration_min) > 0 ? Number(dose.duration_min) : 0,
    status: dose.status === "planned" ? "planned" : "taken",
    notes: dose.notes ? String(dose.notes) : "",
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return { doses: [], settings: normalizeSettings({}) };
    const data = JSON.parse(raw);
    const doses = Array.isArray(data.doses) ? data.doses.map(normalizeDose).filter(Boolean) : [];
    return { doses, settings: normalizeSettings(data.settings || {}) };
  } catch {
    return { doses: [], settings: normalizeSettings({}) };
  }
}

export function saveState(state) {
  localStorage.setItem(DATA_KEY, JSON.stringify({
    doses: state.doses,
    settings: state.settings,
  }));
}

export function loadUi() {
  try {
    const data = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
    return { showHistory: Boolean(data.showHistory) };
  } catch {
    return { showHistory: false };
  }
}

export function saveUi(ui) {
  localStorage.setItem(UI_KEY, JSON.stringify({ showHistory: Boolean(ui.showHistory) }));
}
