import assert from "node:assert/strict";
import test from "node:test";
import { addDays, toDate } from "../js/time.js";
import { PROTOTYPE_SETTINGS } from "../js/settings.js";
import {
  absorptionRate,
  amountRemaining,
  analyzeDate,
  expandImpulses,
  levelAt,
  recencyWeights,
  remainingFromRates,
  sampleSeries,
} from "../js/engine.js";

const D = "2026-06-01";
const D1 = "2026-06-02";
const D2 = "2026-06-03";

function dose(date, time, amount, extra = {}) {
  return {
    id: `${date}-${time}-${amount}`,
    date,
    time,
    amount_mg: amount,
    duration_min: 0,
    status: "taken",
    ...extra,
  };
}

const prototypeDoses = [
  dose(D, "09:00", 189),
  dose(D, "11:00", 151),
  dose(D, "14:45", 79),
  dose(D1, "07:30", 189),
  dose(D1, "10:30", 73),
  dose(D1, "13:45", 48),
  dose(D1, "14:15", 53),
  dose(D2, "09:15", 189),
  dose(D2, "12:15", 73),
];

function at(series, time) {
  const [h, m] = time.split(":").map(Number);
  const minute = h * 60 + m;
  const point = series.find((item) => item.minute === minute);
  assert.ok(point, `missing sample at ${time}`);
  return point;
}

test("a single instant dose matches the prototype quarter-hour decay", () => {
  const doses = [dose(D, "09:00", 189)];
  const series = sampleSeries(doses, PROTOTYPE_SETTINGS, D, 9 * 60, 9 * 60 + 45, 15);
  const levels = ["09:00", "09:15", "09:30", "09:45"].map((time) => at(series, time).L);
  [189, 181, 173.3, 165.9].forEach((expected, index) => {
    assert.ok(Math.abs(levels[index] - expected) <= 0.1, `${levels[index]} vs ${expected}`);
  });
});

test("an instant dose halves after one half-life", () => {
  const settings = { ...PROTOTYPE_SETTINGS };
  const left = amountRemaining(189, settings.half_life_h, settings);
  assert.ok(Math.abs(left - 94.5) < 1e-9);
});

test("first-order absorption peaks at Tmax", () => {
  const settings = {
    ...PROTOTYPE_SETTINGS,
    absorption_mode: "first-order",
    tmax_h: 0.75,
    carry_overnight: true,
  };
  const ke = Math.LN2 / settings.half_life_h;
  const ka = absorptionRate(ke, settings.tmax_h);
  assert.ok(ka > ke);
  const doses = [dose(D, "08:00", 120)];
  const series = sampleSeries(doses, settings, D, 8 * 60, 11 * 60, 1);
  let best = series[0];
  for (const point of series) if (point.L > best.L) best = point;
  assert.ok(Math.abs(best.minute - (8 * 60 + 45)) <= 1, `peak at minute ${best.minute}`);
  const atPeak = amountRemaining(120, 0.75, settings);
  const before = amountRemaining(120, 0.75 - 0.02, settings);
  const after = amountRemaining(120, 0.75 + 0.02, settings);
  assert.ok(atPeak > before && atPeak > after);
});

test("the equal-rate absorption formula stays finite", () => {
  const ke = 0.2;
  const value = remainingFromRates(100, 2, ke, ke);
  const expected = 100 * ke * 2 * Math.exp(-ke * 2);
  assert.ok(Math.abs(value - expected) < 1e-9);
});

test("doses add linearly", () => {
  const settings = { ...PROTOTYPE_SETTINGS, carry_overnight: true };
  const a = [dose(D, "09:00", 80)];
  const b = [dose(D, "11:30", 40)];
  const both = [...a, ...b];
  for (const minute of [9 * 60, 11 * 60 + 30, 15 * 60, 20 * 60]) {
    const sum = levelAt(a, settings, D, minute) + levelAt(b, settings, D, minute);
    assert.ok(Math.abs(levelAt(both, settings, D, minute) - sum) < 1e-6);
  }
});

test("a sipped dose keeps the same total and spreads it out", () => {
  const impulses = expandImpulses([dose(D, "10:00", 60, { duration_min: 30 })]);
  assert.equal(impulses.length, 6);
  const total = impulses.reduce((sum, impulse) => sum + impulse.amount, 0);
  assert.ok(Math.abs(total - 60) < 1e-9);
  const instant = levelAt([dose(D, "10:00", 60)], PROTOTYPE_SETTINGS, D, 10 * 60 + 15);
  const sipped = levelAt([dose(D, "10:00", 60, { duration_min: 30 })], PROTOTYPE_SETTINGS, D, 10 * 60 + 15);
  assert.ok(sipped < instant);
});

test("prototype days match the spreadsheet levels and time-of-day baseline", () => {
  const expected = {
    [`${D1} 09:00`]: [145.7, 126],
    [`${D2} 10:30`]: [152.2, 172.2],
    [`${D2} 12:00`]: [117.4, 175.1],
    [`${D2} 21:00`]: [40.7, 65.8],
  };
  for (const [key, [level, baseline]] of Object.entries(expected)) {
    const [date, time] = key.split(" ");
    const series = sampleSeries(prototypeDoses, PROTOTYPE_SETTINGS, date, parseClock(time), parseClock(time), 15);
    const point = series[0];
    assert.ok(Math.abs(point.L - level) <= 0.1, `${key} L ${point.L} vs ${level}`);
    assert.ok(Math.abs(point.B - baseline) <= 0.1, `${key} B ${point.B} vs ${baseline}`);
  }

  const day1 = sampleSeries(prototypeDoses, PROTOTYPE_SETTINGS, D1, 6 * 60, 21 * 60, 15);
  const day2 = sampleSeries(prototypeDoses, PROTOTYPE_SETTINGS, D2, 6 * 60, 21 * 60, 15);
  assert.equal(day1.length, 61);
  assert.equal(day2.length, 61);
  const mean = (series) => series.reduce((sum, point) => sum + point.B, 0) / series.length;
  assert.ok(Math.abs(mean(day1) - 88.99) <= 0.1, `D+1 mean B ${mean(day1)}`);
  assert.ok(Math.abs(mean(day2) - 123.21) <= 0.1, `D+2 mean B ${mean(day2)}`);
});

test("weights cover every day in the window and are not rescaled to days that have drinks", () => {
  const weights = recencyWeights(2, 0.5);
  assert.ok(Math.abs(weights[0] - 2 / 3) < 1e-12);
  assert.ok(Math.abs(weights[1] - 1 / 3) < 1e-12);
  const settings = {
    ...PROTOTYPE_SETTINGS,
    history_days: 7,
    recency_decay: 0.8,
    carry_overnight: false,
  };
  const doses = [dose(D, "10:00", 100)];
  const next = addDays(D, 1);
  const point = sampleSeries(doses, settings, next, 10 * 60, 10 * 60, 5)[0];
  const full = recencyWeights(7, 0.8)[0] * 100;
  assert.ok(Math.abs(point.B - full) < 1e-6);
  assert.ok(point.B < 40);
});

test("the first caffeine day has no baseline and no crash", () => {
  const view = analyzeDate([dose(D, "09:00", 189)], PROTOTYPE_SETTINGS, D);
  assert.ok(view.points.every((point) => point.B === 0));
  assert.ok(view.points.every((point) => point.D >= -1e-9));
  assert.equal(view.crashOnsetMinute, null);
  assert.equal(view.deficitMgH, 0);
  assert.ok(view.surplusMgH > 0);
  assert.equal(view.peak.minute, 9 * 60);
  assert.ok(Math.abs(view.peak.mg - 189) < 1e-6);
});

test("a repeated pattern sits on the baseline when smoothing is off", () => {
  for (const carry of [false, true]) {
    const settings = {
      ...PROTOTYPE_SETTINGS,
      history_days: 4,
      recency_decay: 0.8,
      carry_overnight: carry,
      smoothing_sigma_min: 0,
    };
    const doses = [];
    for (let day = 0; day < 8; day += 1) {
      const date = addDays(D, day);
      doses.push(dose(date, "09:00", 120), dose(date, "14:00", 60));
    }
    const last = addDays(D, 7);
    const series = sampleSeries(doses, settings, last, 6 * 60, 21 * 60, 15);
    const worst = Math.max(...series.map((point) => Math.abs(point.D)));
    assert.ok(worst < 0.05, `carry ${carry} worst D ${worst}`);
  }
});

test("skipping a habitual morning drink leaves a deficit from about that time", () => {
  const settings = {
    half_life_h: 4,
    absorption_mode: "instant",
    tmax_h: 0.75,
    history_days: 7,
    recency_decay: 1,
    smoothing_sigma_min: 0,
    bedtime: "23:00",
    window_start: "06:00",
    window_end: "24:00",
    carry_overnight: false,
  };
  const doses = [];
  for (let day = 0; day < 7; day += 1) doses.push(dose(addDays(D, day), "10:00", 100));
  const skipped = addDays(D, 7);
  const series = sampleSeries(doses, settings, skipped, 6 * 60, 21 * 60, 15);
  const before = at(series, "09:45");
  const atDrink = at(series, "10:00");
  const afternoon = at(series, "15:00");
  assert.ok(Math.abs(before.D) < 1e-6);
  assert.ok(atDrink.D < -50);
  assert.ok(afternoon.D < -20);
  const view = analyzeDate(doses, settings, skipped);
  assert.ok(view.deficitMgH > 0);
  assert.equal(view.crashOnsetMinute, null);
});

test("smoothing lifts the baseline before the usual drink", () => {
  const sharp = {
    ...PROTOTYPE_SETTINGS,
    history_days: 1,
    recency_decay: 1,
    smoothing_sigma_min: 0,
  };
  const soft = { ...sharp, smoothing_sigma_min: 30 };
  const doses = [dose(D, "10:00", 100), dose(D1, "10:00", 100)];
  const unsmoothed = sampleSeries(doses, sharp, D1, 9 * 60 + 30, 9 * 60 + 30, 5)[0];
  const smoothed = sampleSeries(doses, soft, D1, 9 * 60 + 30, 9 * 60 + 30, 5)[0];
  assert.ok(unsmoothed.B < 1);
  assert.ok(smoothed.B > unsmoothed.B);
  assert.ok(smoothed.D < 0);
});

test("after K caffeine-free days the baseline is gone and the reset date matches", () => {
  const settings = { ...PROTOTYPE_SETTINGS, history_days: 2, carry_overnight: false };
  const doses = [dose(D, "09:00", 189)];
  const resetDay = addDays(D, 3);
  const cleared = sampleSeries(doses, settings, resetDay, 0, 21 * 60, 60);
  assert.ok(cleared.every((point) => Math.abs(point.B) < 1e-6));
  const stillThere = sampleSeries(doses, settings, addDays(D, 2), 9 * 60, 9 * 60, 15)[0];
  assert.ok(stillThere.B > 1);
  const view = analyzeDate(doses, settings, D);
  assert.equal(view.reset.kind, "date");
  assert.equal(view.reset.date, resetDay);
});

test("a late dose is still there the next morning only when overnight carry is on", () => {
  const doses = [dose(D, "23:00", 100)];
  const on = levelAt(doses, { ...PROTOTYPE_SETTINGS, carry_overnight: true }, D1, 7 * 60);
  const off = levelAt(doses, { ...PROTOTYPE_SETTINGS, carry_overnight: false }, D1, 7 * 60);
  assert.ok(Math.abs(on - 25) < 1e-6);
  assert.equal(off, 0);
});

test("the same clock time is used on the next calendar day", () => {
  const next = addDays("2026-11-01", 1);
  const morning = toDate(next, 9 * 60 + 30);
  assert.equal(morning.getHours(), 9);
  assert.equal(morning.getMinutes(), 30);
  const hours = (toDate(D1, 6 * 60).getTime() - toDate(D, 22 * 60).getTime()) / 36e5;
  assert.ok(hours > 6 && hours < 10);
});

test("planned doses count toward the level", () => {
  const planned = dose(D, "09:00", 50, { status: "planned" });
  assert.ok(Math.abs(levelAt([planned], PROTOTYPE_SETTINGS, D, 9 * 60) - 50) < 1e-9);
});

function parseClock(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
