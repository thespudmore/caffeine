import { analyzeDate } from "./engine.js";
import { drawChart } from "./chart.js";
import { MULTIPLIERS, PRESETS, presetById } from "./presets.js";
import { DEFAULT_SETTINGS, PROTOTYPE_SETTINGS, normalizeSettings } from "./settings.js";
import { loadState, loadUi, normalizeDose, saveState, saveUi } from "./storage.js";
import { dosesToCsv, exportBackup, parseBackup, parseCsv } from "./csv.js";
import {
  addDays,
  compareIso,
  formatTime,
  isValidDate,
  nowMinutes,
  parseTime,
  prettyDate,
  shortDate,
  startOfWeek,
  todayIso,
  weekdayShort,
} from "./time.js";

const $ = (id) => document.getElementById(id);

let doses = [];
let settings = normalizeSettings({});
let selected = todayIso();
let showHistory = false;
let editingId = null;
let view = null;
let drawnWidth = -1;
let toastTimer = 0;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `dose-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function fmtMg(value) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(1));
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return rounded.toFixed(1);
}

function fmtSigned(value) {
  const text = fmtMg(Math.abs(value));
  if (value > 0.05) return `+${text}`;
  if (value < -0.05) return `−${text}`;
  return "0";
}

function persist() {
  try {
    saveState({ doses, settings });
    saveUi({ showHistory });
  } catch {
    toast("Could not save in this browser.");
  }
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}

function syncUrl() {
  const url = new URL(location.href);
  url.searchParams.set("date", selected);
  history.replaceState(null, "", url);
}

function setDate(iso) {
  if (!isValidDate(iso)) return;
  selected = iso;
  syncUrl();
  render();
}

function dosesOn(date) {
  return doses
    .filter((dose) => dose.date === date)
    .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

function renderHeading() {
  const today = todayIso();
  let kicker = "";
  if (selected === today) kicker = "Today";
  else if (selected === addDays(today, -1)) kicker = "Yesterday";
  else if (selected === addDays(today, 1)) kicker = "Tomorrow";
  else if (compareIso(selected, today) > 0) kicker = "Future day";
  $("day-kicker").textContent = kicker;
  $("day-heading").textContent = prettyDate(selected);
  $("date-input").value = selected;
}

function renderWeek() {
  const start = startOfWeek(selected);
  const today = todayIso();
  const row = $("week");
  row.replaceChildren();
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i);
    const total = dosesOn(date).reduce((sum, dose) => sum + dose.amount_mg, 0);
    const button = el("button", {
      type: "button",
      class: date === today ? "is-today" : "",
      "aria-current": date === selected ? "date" : false,
      "aria-label": `${prettyDate(date)}, ${fmtMg(total)} mg`,
    }, [
      el("strong", { text: weekdayShort(date) }),
      el("span", { class: "day-num", text: String(Number(date.slice(-2))) }),
      el("span", { class: "day-mg", text: total > 0 ? `${fmtMg(total)} mg` : "—" }),
    ]);
    button.addEventListener("click", () => setDate(date));
    row.append(button);
  }
}

function stat(label, value, detail, tone = "") {
  return el("article", { class: tone ? `stat ${tone}` : "stat" }, [
    el("h3", { text: label }),
    el("p", { class: "stat-value", text: value }),
    el("p", { class: "stat-detail", text: detail }),
  ]);
}

function renderSummary() {
  const cards = [];
  if (view.now) {
    const tone = view.now.D > 0.05 ? "up" : view.now.D < -0.05 ? "down" : "";
    const phrase = view.now.D > 0.05 ? "Above baseline" : view.now.D < -0.05 ? "Below baseline" : "Level with baseline";
    cards.push(stat("Right now", `${fmtSigned(view.now.D)} mg`, `${phrase} · level ${fmtMg(view.now.L)} mg`, tone));
  }
  const over = view.totalMg > 400;
  cards.push(stat(
    "Logged",
    `${fmtMg(view.totalMg)} mg`,
    over ? "Above the 400 mg adult reference. Not advice." : `${view.doseCount} dose${view.doseCount === 1 ? "" : "s"}`,
    over ? "down" : "",
  ));
  cards.push(stat(
    "Peak level",
    `${fmtMg(view.peak.mg)} mg`,
    view.peak.mg < 0.05 ? "Nothing in the body" : `at ${formatTime(view.peak.minute)}`,
  ));
  cards.push(stat("At bedtime", `${fmtMg(view.bedtime.mg)} mg`, formatTime(view.bedtime.minute)));
  cards.push(stat("Above baseline", `${fmtMg(view.surplusMgH)} mg·h`, "Where level exceeds the habit", view.surplusMgH > 0.05 ? "up" : ""));
  const deepest = view.largestDeficit
    ? `Deepest ${fmtMg(Math.abs(view.largestDeficit.mg))} mg at ${formatTime(view.largestDeficit.minute)}`
    : "Stays on or above the habit";
  cards.push(stat("Below baseline", `${fmtMg(view.deficitMgH)} mg·h`, deepest, view.deficitMgH > 0.05 ? "down" : ""));
  let crashDetail = "Does not fall under baseline after the first dose";
  if (view.doseCount === 0) crashDetail = "No dose to fall from";
  else if (view.crashOnsetMinute != null) crashDetail = "First drop under baseline after the first dose";
  else if (view.deficitMgH > 0.05) crashDetail = "The lack starts before the first dose";
  cards.push(stat(
    "Crash onset",
    view.crashOnsetMinute == null ? "None" : formatTime(Math.round(view.crashOnsetMinute)),
    crashDetail,
    view.crashOnsetMinute == null ? "" : "down",
  ));
  let resetValue = "Under 1 mg";
  let resetDetail = doses.length ? "Baseline stays under 1 mg" : "No doses logged";
  if (view.reset.kind === "date") {
    if (view.reset.date <= selected) {
      resetValue = "Under 1 mg";
      resetDetail = `Since ${shortDate(view.reset.date)}`;
    } else {
      resetValue = shortDate(view.reset.date);
      resetDetail = "If you add no further doses";
    }
  }
  cards.push(stat("Baseline reset", resetValue, resetDetail));
  $("summary").replaceChildren(...cards);
}

function renderDoses() {
  const todays = dosesOn(selected);
  $("dose-empty").hidden = todays.length > 0;
  $("copy-previous").disabled = dosesOn(addDays(selected, -1)).length === 0;
  const list = $("dose-list");
  list.replaceChildren();
  for (const dose of todays) {
    const meta = [];
    if (dose.duration_min > 0) meta.push(`Sipped over ${dose.duration_min} min`);
    if (dose.notes) meta.push(dose.notes);
    list.append(el("li", { class: "dose", "data-id": dose.id }, [
      el("time", { text: dose.time, datetime: `${dose.date}T${dose.time}` }),
      el("div", {}, [
        el("p", { class: "dose-label", text: dose.label || "Caffeine" }),
        meta.length ? el("p", { class: "dose-meta", text: meta.join(" · ") }) : null,
      ]),
      el("div", { class: "dose-side" }, [
        el("p", { class: "dose-amount", text: `${fmtMg(dose.amount_mg)} mg` }),
        el("span", { class: `pill ${dose.status}`, text: dose.status === "planned" ? "Planned" : "Taken" }),
        el("div", { class: "dose-actions" }, [
          el("button", { type: "button", "data-action": "edit", text: "Edit" }),
          el("button", { type: "button", "data-action": "delete", text: "Delete" }),
        ]),
      ]),
    ]));
  }
  const start = parseTime(settings.window_start);
  const end = parseTime(settings.window_end);
  const outside = todays.filter((dose) => {
    const minute = parseTime(dose.time);
    return minute < start || minute > end;
  }).length;
  $("outside-note").textContent = outside
    ? `${outside} dose${outside === 1 ? "" : "s"} outside this window still feed the curve.`
    : "";
}

function relativePhrase(value) {
  if (value > 0.05) return `${fmtSigned(value)} mg above baseline`;
  if (value < -0.05) return `${fmtMg(Math.abs(value))} mg below baseline`;
  return "Level with baseline";
}

function showReadout(point) {
  const chosen = point || defaultPoint();
  const readout = $("readout");
  if (!chosen) {
    readout.textContent = "Move across the chart for the level, the baseline, and the gap.";
    return;
  }
  const tone = chosen.D > 0.05 ? "up" : chosen.D < -0.05 ? "down" : "";
  readout.replaceChildren(
    document.createTextNode(`${formatTime(chosen.minute)} · Level ${fmtMg(chosen.L)} mg · Baseline ${fmtMg(chosen.B)} mg · `),
    el("strong", { class: tone, text: relativePhrase(chosen.D) }),
  );
}

function defaultPoint() {
  if (!view || !view.points.length) return null;
  const start = parseTime(settings.window_start);
  const end = parseTime(settings.window_end);
  if (view.now && view.now.minute >= start && view.now.minute <= end) return view.now;
  return view.points.reduce((best, point) => (point.L > best.L ? point : best), view.points[0]);
}

function draw() {
  const host = $("chart-host");
  const width = Math.round(host.clientWidth);
  if (!width || !view) return;
  drawnWidth = width;
  drawChart(host, {
    points: view.points,
    history: view.history,
    markers: view.markers,
    showHistory,
    nowMinute: selected === todayIso() ? Math.max(0, Math.min(1440, Math.round(nowMinutes() / 5) * 5)) : null,
    start: parseTime(settings.window_start),
    end: parseTime(settings.window_end),
    label: `Caffeine level and adapted baseline for ${prettyDate(selected)}`,
  }, showReadout);
  showReadout(null);
}

function render() {
  const clock = selected === todayIso() ? nowMinutes() : null;
  view = analyzeDate(doses, settings, selected, clock);
  renderHeading();
  renderWeek();
  renderSummary();
  renderDoses();
  requestAnimationFrame(draw);
}

function fillTimeSelect(select, from, to) {
  select.replaceChildren();
  for (let minute = from; minute <= to; minute += 30) {
    select.append(el("option", { value: formatTime(minute), text: formatTime(minute) }));
  }
}

function updateOutputs() {
  $("hl-out").textContent = `${Number(settings.half_life_h).toFixed(1)} h`;
  $("tmax-out").textContent = `${Number(settings.tmax_h).toFixed(2)} h`;
  $("history-out").textContent = `${settings.history_days} days`;
  $("lambda-out").textContent = Number(settings.recency_decay).toFixed(2);
  $("sigma-out").textContent = `${settings.smoothing_sigma_min} min`;
}

function syncAbsorption() {
  const instant = settings.absorption_mode === "instant";
  $("tmax").disabled = instant;
  $("tmax-field").classList.toggle("is-off", instant);
}

let fillingSettings = false;

function fillSettings() {
  fillingSettings = true;
  $("hl").value = settings.half_life_h;
  $("tmax").value = settings.tmax_h;
  $("history").value = settings.history_days;
  $("lambda").value = settings.recency_decay;
  $("sigma").value = settings.smoothing_sigma_min;
  $("bedtime").value = settings.bedtime === "24:00" ? "23:59" : settings.bedtime;
  $("window-start").value = settings.window_start;
  $("window-end").value = settings.window_end;
  $("carry").checked = settings.carry_overnight;
  const mode = document.querySelector(`input[name="absorption"][value="${settings.absorption_mode}"]`);
  if (mode) mode.checked = true;
  updateOutputs();
  syncAbsorption();
  fillingSettings = false;
}

function onSettingsInput() {
  if (fillingSettings) return;
  settings = normalizeSettings({
    half_life_h: $("hl").value,
    absorption_mode: document.querySelector('input[name="absorption"]:checked')?.value,
    tmax_h: $("tmax").value,
    history_days: $("history").value,
    recency_decay: $("lambda").value,
    smoothing_sigma_min: $("sigma").value,
    bedtime: $("bedtime").value,
    window_start: $("window-start").value,
    window_end: $("window-end").value,
    carry_overnight: $("carry").checked,
  });
  if ($("window-start").value !== settings.window_start) $("window-start").value = settings.window_start;
  if ($("window-end").value !== settings.window_end) $("window-end").value = settings.window_end;
  updateOutputs();
  syncAbsorption();
  persist();
  render();
}

function applySettings(next, message) {
  settings = normalizeSettings(next);
  persist();
  fillSettings();
  render();
  toast(message);
}

function setWindow(start, end) {
  settings = normalizeSettings({ ...settings, window_start: start, window_end: end });
  persist();
  fillSettings();
  render();
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function loadExample() {
  if (doses.length && !confirm("Add the three example days on top of this log?")) return;
  const end = todayIso();
  const rows = [
    [-2, "09:00", 189, "Dare mocha, 750 ml", "dare-mocha-750"],
    [-2, "11:00", 151, "Red Bull, 473 ml", "redbull-473"],
    [-2, "14:45", 79, "Red Bull, 250 ml", "redbull-250"],
    [-1, "07:30", 189, "Dare mocha, 750 ml", "dare-mocha-750"],
    [-1, "10:30", 73, "Sugar-free V, 250 ml", "sf-v-250"],
    [-1, "13:45", 48, "Diet Coke, 375 ml", "diet-coke-375"],
    [-1, "14:15", 53, "Top-up", ""],
    [0, "09:15", 189, "Dare mocha, 750 ml", "dare-mocha-750"],
    [0, "12:15", 73, "Sugar-free V, 250 ml", "sf-v-250"],
  ];
  for (const [offset, time, amount, label, preset] of rows) {
    const dose = normalizeDose({
      id: uid(),
      date: addDays(end, offset),
      time,
      amount_mg: amount,
      label,
      preset_id: preset,
      duration_min: 0,
      status: "taken",
    });
    if (dose) doses.push(dose);
  }
  selected = end;
  syncUrl();
  persist();
  render();
  toast("Example days added. Prototype values in Settings match the spreadsheet.");
}

function selectedMultiplier() {
  return Number(document.querySelector('input[name="multiplier"]:checked')?.value || 1);
}

function applyPresetToForm() {
  const preset = presetById($("dose-preset").value);
  $("multiplier-set").disabled = !preset;
  if (!preset) return;
  const multiplier = selectedMultiplier();
  $("dose-amount").value = String(Math.round(preset.amount_mg * multiplier * 10) / 10);
  const known = MULTIPLIERS.find((item) => item.value === multiplier);
  $("dose-label").value = multiplier === 1 || !known ? preset.name : `${preset.name} × ${known.label}`;
}

function openDose(existing) {
  editingId = existing ? existing.id : null;
  $("dose-title").textContent = existing ? "Edit dose" : "Add dose";
  $("dose-save").textContent = existing ? "Save changes" : "Save dose";
  $("dose-error").textContent = "";
  $("dose-form").reset();
  const future = compareIso(selected, todayIso()) > 0;
  const status = existing?.status || (future ? "planned" : "taken");
  $("dose-time").value = existing?.time || (selected === todayIso() ? formatTime(nowMinutes()) : "");
  $("dose-amount").value = existing ? String(existing.amount_mg) : "";
  $("dose-label").value = existing?.label || "";
  $("dose-notes").value = existing?.notes || "";
  $("dose-duration").value = existing ? String(existing.duration_min || 0) : "0";
  $("dose-preset").value = existing?.preset_id && presetById(existing.preset_id) ? existing.preset_id : "";
  const preset = presetById($("dose-preset").value);
  let multiplier = "1";
  if (preset && existing) {
    const ratio = existing.amount_mg / preset.amount_mg;
    const match = MULTIPLIERS.find((item) => Math.abs(item.value - ratio) < 0.02);
    if (match) multiplier = String(match.value);
  }
  document.querySelector(`input[name="multiplier"][value="${multiplier}"]`).checked = true;
  document.querySelector(`input[name="status"][value="${status}"]`).checked = true;
  $("multiplier-set").disabled = !preset;
  $("dose-dialog").showModal();
  $("dose-time").focus();
}

function saveDose(event) {
  event.preventDefault();
  const time = $("dose-time").value.slice(0, 5);
  const amount = Number($("dose-amount").value);
  if (parseTime(time) == null) {
    $("dose-error").textContent = "Choose a time.";
    return;
  }
  if (!(amount > 0)) {
    $("dose-error").textContent = "Amount has to be above 0.";
    return;
  }
  const dose = normalizeDose({
    id: editingId || uid(),
    date: selected,
    time,
    amount_mg: amount,
    label: $("dose-label").value.trim(),
    preset_id: $("dose-preset").value,
    duration_min: Number($("dose-duration").value) || 0,
    status: document.querySelector('input[name="status"]:checked')?.value || "taken",
    notes: $("dose-notes").value.trim(),
  });
  if (!dose) {
    $("dose-error").textContent = "Check the time and the amount.";
    return;
  }
  if (editingId) {
    const index = doses.findIndex((item) => item.id === editingId);
    if (index >= 0) doses[index] = dose;
  } else doses.push(dose);
  persist();
  $("dose-dialog").close();
  render();
  toast(editingId ? "Dose updated." : "Dose added.");
}

function onDoseListClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const row = button.closest("[data-id]");
  const id = row?.dataset.id;
  if (!id) return;
  if (button.dataset.action === "edit") {
    const dose = doses.find((item) => item.id === id);
    if (dose) openDose(dose);
    return;
  }
  if (button.dataset.action !== "delete") return;
  if (button.dataset.armed === "yes") {
    doses = doses.filter((item) => item.id !== id);
    persist();
    render();
    toast("Dose removed.");
    return;
  }
  button.dataset.armed = "yes";
  button.textContent = "Remove?";
  setTimeout(() => {
    if (!button.isConnected) return;
    button.dataset.armed = "";
    button.textContent = "Delete";
  }, 2400);
}

function copyPrevious() {
  const source = dosesOn(addDays(selected, -1));
  if (!source.length) {
    toast("Nothing logged the day before.");
    return;
  }
  const future = compareIso(selected, todayIso()) > 0;
  for (const dose of source) {
    const copy = normalizeDose({
      ...dose,
      id: uid(),
      date: selected,
      status: future ? "planned" : dose.status,
    });
    if (copy) doses.push(copy);
  }
  persist();
  render();
  toast(`Copied ${source.length} dose${source.length === 1 ? "" : "s"}.`);
}

async function onImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const text = await file.text();
  if (text.trim().startsWith("{")) {
    try {
      const backup = parseBackup(text);
      const replace = confirm(`Replace this browser’s log with ${backup.doses.length} doses from the backup?`);
      if (!replace) return;
      doses = backup.doses.map(normalizeDose).filter(Boolean);
      if (backup.settings) settings = backup.settings;
      persist();
      fillSettings();
      render();
      toast("Backup restored.");
    } catch (error) {
      toast(error.message || "Could not read that backup.");
    }
    return;
  }
  const parsed = parseCsv(text);
  const imported = parsed.doses.map(normalizeDose).filter(Boolean);
  if (!imported.length) {
    toast(parsed.errors[0] || "No doses found in that CSV.");
    return;
  }
  doses.push(...imported);
  persist();
  render();
  const skipped = parsed.errors.length ? ` ${parsed.errors.length} rows skipped.` : "";
  toast(`Added ${imported.length} doses.${skipped}`);
}

function clearDoses() {
  if (!doses.length) {
    toast("The log is already empty.");
    return;
  }
  if (!confirm("Delete every dose in this browser? Settings stay as they are.")) return;
  doses = [];
  persist();
  render();
  toast("Doses cleared.");
}

function bind() {
  $("prev-day").addEventListener("click", () => setDate(addDays(selected, -1)));
  $("next-day").addEventListener("click", () => setDate(addDays(selected, 1)));
  $("today-btn").addEventListener("click", () => setDate(todayIso()));
  $("date-input").addEventListener("change", () => setDate($("date-input").value));
  $("settings-open").addEventListener("click", () => {
    fillSettings();
    $("settings-dialog").showModal();
  });
  $("settings-close").addEventListener("click", () => $("settings-dialog").close());
  $("settings-form").addEventListener("submit", (event) => event.preventDefault());
  $("settings-form").addEventListener("input", onSettingsInput);
  $("settings-form").addEventListener("change", onSettingsInput);
  $("use-defaults").addEventListener("click", () => applySettings(DEFAULT_SETTINGS, "Suggested defaults loaded."));
  $("use-prototype").addEventListener("click", () => applySettings(PROTOTYPE_SETTINGS, "Prototype values loaded."));
  $("window-morning").addEventListener("click", () => setWindow("06:00", "24:00"));
  $("window-full").addEventListener("click", () => setWindow("00:00", "24:00"));
  $("add-dose").addEventListener("click", () => openDose(null));
  $("dose-cancel").addEventListener("click", () => $("dose-dialog").close());
  $("dose-form").addEventListener("submit", saveDose);
  $("dose-preset").addEventListener("change", applyPresetToForm);
  $("multiplier-set").addEventListener("change", applyPresetToForm);
  $("dose-list").addEventListener("click", onDoseListClick);
  $("copy-previous").addEventListener("click", copyPrevious);
  $("load-example").addEventListener("click", loadExample);
  $("load-example-settings").addEventListener("click", loadExample);
  $("show-history").addEventListener("change", () => {
    showHistory = $("show-history").checked;
    persist();
    draw();
  });
  $("export-json").addEventListener("click", () => {
    download(`caffeine-backup-${todayIso()}.json`, exportBackup(doses, settings), "application/json");
  });
  $("export-csv").addEventListener("click", () => {
    download(`caffeine-doses-${todayIso()}.csv`, dosesToCsv(doses), "text/csv");
  });
  $("import-btn").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (event) => {
    event.stopPropagation();
    onImport(event);
  });
  $("clear-data").addEventListener("click", clearDoses);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.target.closest("input, textarea, select, dialog")) return;
    setDate(addDays(selected, event.key === "ArrowLeft" ? -1 : 1));
  });
  for (const input of document.querySelectorAll('input[type="number"]')) {
    input.addEventListener("wheel", () => input.blur(), { passive: true });
  }
  const host = $("chart-host");
  new ResizeObserver(() => {
    const width = Math.round(host.clientWidth);
    if (width && width !== drawnWidth) draw();
  }).observe(host);
}

function init() {
  const stored = loadState();
  doses = stored.doses;
  settings = stored.settings;
  showHistory = loadUi().showHistory;
  const requested = new URLSearchParams(location.search).get("date");
  if (isValidDate(requested)) selected = requested;
  for (const preset of PRESETS) {
    $("dose-preset").append(el("option", { value: preset.id, text: `${preset.name} · ${preset.amount_mg} mg` }));
  }
  fillTimeSelect($("window-start"), 0, 23 * 60 + 30);
  fillTimeSelect($("window-end"), 30, 1440);
  $("show-history").checked = showHistory;
  $("multiplier-set").disabled = true;
  fillSettings();
  bind();
  $("boot-note").remove();
  $("app").hidden = false;
  render();
}

init();
