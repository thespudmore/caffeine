import { isValidDate, parseTime } from "./time.js";
import { normalizeSettings } from "./settings.js";

const COLUMNS = ["date", "time", "mg", "label", "status", "duration_min", "notes"];

function escapeCell(value) {
  const text = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function dosesToCsv(doses) {
  const lines = [COLUMNS.join(",")];
  const sorted = [...doses].sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  for (const dose of sorted) {
    lines.push([
      dose.date,
      dose.time,
      dose.amount_mg,
      dose.label || "",
      dose.status || "taken",
      dose.duration_min || 0,
      dose.notes || "",
    ].map(escapeCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function splitCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.trim() !== ""));
}

function headerIndex(header) {
  const names = header.map((value) => value.trim().toLowerCase());
  const dateAt = names.findIndex((name) => name === "date");
  if (dateAt === -1) return null;
  const pick = (aliases) => names.findIndex((name) => aliases.includes(name));
  return {
    date: dateAt,
    time: pick(["time"]),
    mg: pick(["mg", "amount", "amount_mg", "caffeine"]),
    label: pick(["label", "name", "drink"]),
    status: pick(["status"]),
    duration: pick(["duration_min", "duration", "minutes"]),
    notes: pick(["notes", "note"]),
  };
}

let csvIds = 0;

export function parseCsv(text) {
  const rows = splitCsv(text);
  const doses = [];
  const errors = [];
  if (rows.length === 0) return { doses, errors: ["The file is empty."] };
  const indexed = headerIndex(rows[0]);
  const start = indexed ? 1 : 0;
  const columns = indexed || { date: 0, time: 1, mg: 2, label: 3, status: 4, duration: 5, notes: 6 };
  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i];
    const get = (index) => (index == null || index < 0 ? "" : (row[index] || "").trim());
    const date = get(columns.date);
    const time = get(columns.time);
    const mg = Number(get(columns.mg));
    if (!isValidDate(date) || parseTime(time) == null || !(mg > 0)) {
      errors.push(`Row ${i + 1} needs a date, a time, and an amount above 0.`);
      continue;
    }
    const status = get(columns.status).toLowerCase() === "planned" ? "planned" : "taken";
    const duration = Number(get(columns.duration));
    let label = get(columns.label);
    if (label.startsWith("'") && /^[=+\-@]/.test(label.slice(1))) label = label.slice(1);
    csvIds += 1;
    doses.push({
      id: `csv-${Date.now().toString(36)}-${csvIds}`,
      date,
      time: time.length === 4 ? `0${time}` : time,
      amount_mg: mg,
      label,
      duration_min: Number.isFinite(duration) && duration > 0 ? duration : 0,
      status,
      notes: get(columns.notes),
    });
  }
  return { doses, errors };
}

export function exportBackup(doses, settings) {
  return JSON.stringify({
    version: 1,
    exported_at: new Date().toISOString(),
    settings,
    doses,
  }, null, 2);
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.doses)) throw new Error("This backup has no dose list.");
  const doses = [];
  for (const dose of data.doses) {
    if (!dose || !isValidDate(dose.date) || parseTime(dose.time) == null || !(Number(dose.amount_mg) > 0)) continue;
    doses.push({
      id: typeof dose.id === "string" && dose.id ? dose.id : `dose-${Math.random().toString(36).slice(2)}`,
      date: dose.date,
      time: dose.time,
      amount_mg: Number(dose.amount_mg),
      label: dose.label ? String(dose.label) : "",
      preset_id: dose.preset_id ? String(dose.preset_id) : "",
      duration_min: Number(dose.duration_min) > 0 ? Number(dose.duration_min) : 0,
      status: dose.status === "planned" ? "planned" : "taken",
      notes: dose.notes ? String(dose.notes) : "",
    });
  }
  return {
    doses,
    settings: data.settings ? normalizeSettings(data.settings) : null,
  };
}
