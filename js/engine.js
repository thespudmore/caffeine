/**
 * Caffeine level, adapted baseline, and relative energy.
 * Pure functions: doses and settings in, series out. Nothing is stored here.
 *
 * L is the caffeine still in the body. B is the level the recent routine
 * would lead you to expect at the same clock time. D = L - B.
 * Smoothing makes B rise a little before a usual dose, so a skipped drink
 * shows up early. With smoothing above zero, a perfectly repeated habit is
 * a small wave around zero rather than a perfectly flat line, because B is
 * the rounded habit and L is the sharp curve. Sigma 0 makes a long enough
 * repeated pattern flat.
 */
import { addDays, formatDate, parseTime, toDate } from "./time.js";

const LN2 = Math.LN2;

export function recencyWeights(days, lambda) {
  const raw = [];
  let sum = 0;
  for (let k = 0; k < days; k += 1) {
    const weight = lambda ** k;
    raw.push(weight);
    sum += weight;
  }
  if (sum === 0) return raw.map((_, i) => (i === 0 ? 1 : 0));
  return raw.map((weight) => weight / sum);
}

export function eliminationRate(halfLifeH) {
  if (!(halfLifeH > 0)) throw new Error("Half-life must be positive.");
  return LN2 / halfLifeH;
}

/** Solve Tmax = ln(ka/ke) / (ka - ke) for ka > ke. */
export function absorptionRate(ke, tmaxH) {
  if (!(tmaxH > 0)) throw new Error("Time to peak must be positive.");
  const c = ke * tmaxH;
  if (c >= 0.999) return ke * 1.001;
  const f = (r) => Math.log(r) - c * (r - 1);
  let lo = 1.0000001;
  let hi = 2;
  while (f(hi) > 0 && hi < 1e9) hi *= 2;
  for (let i = 0; i < 70; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return ke * ((lo + hi) / 2);
}

export function remainingFromRates(amount, sHours, ka, ke) {
  if (sHours < 0 || amount === 0) return 0;
  if (ka == null) return amount * Math.exp(-ke * sHours);
  if (Math.abs(ka - ke) <= 1e-8 * ke) return amount * ke * sHours * Math.exp(-ke * sHours);
  return amount * (ka / (ka - ke)) * (Math.exp(-ke * sHours) - Math.exp(-ka * sHours));
}

function ratesFor(settings) {
  const ke = eliminationRate(settings.half_life_h);
  if (settings.absorption_mode === "instant") return { ke, ka: null };
  return { ke, ka: absorptionRate(ke, settings.tmax_h) };
}

export function amountRemaining(amount, sHours, settings) {
  const { ke, ka } = ratesFor(settings);
  return remainingFromRates(amount, sHours, ka, ke);
}

/**
 * A dose sipped over time becomes equal pieces, one per five minutes,
 * each placed at the middle of its slice so the pieces cover the whole drink.
 */
export function expandImpulses(doses) {
  const impulses = [];
  for (const dose of doses) {
    const amount = Number(dose.amount_mg);
    if (!(amount > 0) || !dose.date) continue;
    const startMin = parseTime(dose.time);
    if (startMin == null) continue;
    const duration = Math.max(0, Number(dose.duration_min) || 0);
    const pieces = duration <= 0 ? 1 : Math.max(1, Math.round(duration / 5));
    const start = toDate(dose.date, startMin).getTime();
    for (let i = 0; i < pieces; i += 1) {
      const offsetMin = duration <= 0 ? 0 : (i + 0.5) * (duration / pieces);
      const when = new Date(start + offsetMin * 60000);
      impulses.push({
        t: when.getTime(),
        date: formatDate(when),
        amount: amount / pieces,
      });
    }
  }
  return impulses;
}

function levelFromImpulses(impulses, settings, rates, t, calendarDate) {
  let sum = 0;
  for (const impulse of impulses) {
    if (!settings.carry_overnight && impulse.date !== calendarDate) continue;
    const sHours = (t - impulse.t) / 36e5;
    if (sHours < 0) continue;
    sum += remainingFromRates(impulse.amount, sHours, rates.ka, rates.ke);
  }
  return sum;
}

function smoothLevels(points, sigmaMin) {
  const raw = points.map((point) => point.L);
  if (!(sigmaMin > 0) || points.length === 0) {
    for (let i = 0; i < points.length; i += 1) points[i].Ls = raw[i];
    return;
  }
  const sigmaMs = sigmaMin * 60 * 1000;
  const radiusMs = 4 * sigmaMs;
  for (let i = 0; i < points.length; i += 1) {
    const t = points[i].t;
    let acc = 0;
    let weightSum = 0;
    for (let j = i; j >= 0; j -= 1) {
      const dt = t - points[j].t;
      if (dt > radiusMs) break;
      const weight = Math.exp(-0.5 * (dt / sigmaMs) ** 2);
      acc += weight * raw[j];
      weightSum += weight;
    }
    for (let j = i + 1; j < points.length; j += 1) {
      const dt = points[j].t - t;
      if (dt > radiusMs) break;
      const weight = Math.exp(-0.5 * (dt / sigmaMs) ** 2);
      acc += weight * raw[j];
      weightSum += weight;
    }
    points[i].Ls = weightSum > 0 ? acc / weightSum : raw[i];
  }
}

function prepare(doses, settings, startDate, endDate, stepMin) {
  const pad = Math.max(1, Math.ceil((4 * (settings.smoothing_sigma_min || 0)) / 1440) + 1);
  const gridStart = addDays(startDate, -pad);
  const gridEnd = addDays(endDate, pad);
  const rates = ratesFor(settings);
  const cutoff = addDays(gridStart, -14);
  const impulses = expandImpulses(doses.filter((dose) => dose.date >= cutoff && dose.date <= addDays(gridEnd, 1)));
  const points = [];
  for (let date = gridStart; date <= gridEnd; date = addDays(date, 1)) {
    for (let minute = 0; minute < 1440; minute += stepMin) {
      const when = toDate(date, minute);
      const point = { date, minute, t: when.getTime(), L: 0, Ls: 0 };
      point.L = levelFromImpulses(impulses, settings, rates, point.t, date);
      points.push(point);
    }
  }
  points.sort((a, b) => a.t - b.t || a.minute - b.minute);
  smoothLevels(points, settings.smoothing_sigma_min);
  const map = new Map();
  for (const point of points) map.set(`${point.date}#${point.minute}`, point);
  return {
    settings,
    rates,
    impulses,
    map,
    stepMin,
    weights: recencyWeights(settings.history_days, settings.recency_decay),
  };
}

function directLevel(model, date, minute) {
  const rolled = minute >= 1440;
  const calendarDate = model.settings.carry_overnight && rolled ? addDays(date, 1) : date;
  const clock = rolled ? 1440 : minute;
  return levelFromImpulses(model.impulses, model.settings, model.rates, toDate(date, clock).getTime(), calendarDate);
}

function readL(model, date, minute) {
  if (minute >= 1440) {
    if (model.settings.carry_overnight) return readL(model, addDays(date, 1), 0);
    return directLevel(model, date, 1440);
  }
  const point = model.map.get(`${date}#${minute}`);
  if (point) return point.L;
  return directLevel(model, date, minute);
}

function readLs(model, date, minute) {
  if (minute >= 1440) {
    if (model.settings.carry_overnight) return readLs(model, addDays(date, 1), 0);
    return directLevel(model, date, 1440);
  }
  const point = model.map.get(`${date}#${minute}`);
  if (point) return point.Ls;
  return 0;
}

function readPoint(model, date, minute) {
  const L = readL(model, date, minute);
  let B = 0;
  const days = model.settings.history_days;
  for (let k = 1; k <= days; k += 1) {
    B += model.weights[k - 1] * readLs(model, addDays(date, -k), minute);
  }
  return { minute, L, B, D: L - B };
}

export function sampleSeries(doses, settings, date, startMin, endMin, stepMin = 5) {
  const history = settings.history_days;
  const model = prepare(doses, settings, addDays(date, -history), date, stepMin);
  const points = [];
  for (let minute = startMin; minute <= endMin + 1e-9; minute += stepMin) {
    points.push(readPoint(model, date, minute));
  }
  return points;
}

export function levelAt(doses, settings, date, minute) {
  const model = prepare(doses, settings, date, date, 5);
  return directLevel(model, date, minute);
}

function integrateGaps(points) {
  let surplus = 0;
  let deficit = 0;
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    const hours = (right.minute - left.minute) / 60;
    if (!(hours > 0)) continue;
    const d0 = left.D;
    const d1 = right.D;
    if (d0 >= 0 && d1 >= 0) surplus += ((d0 + d1) / 2) * hours;
    else if (d0 <= 0 && d1 <= 0) deficit += ((-d0 + -d1) / 2) * hours;
    else {
      const u = d0 / (d0 - d1);
      const leftHours = u * hours;
      const rightHours = (1 - u) * hours;
      const leftArea = Math.abs(d0) / 2 * leftHours;
      const rightArea = Math.abs(d1) / 2 * rightHours;
      if (d0 > 0) {
        surplus += leftArea;
        deficit += rightArea;
      } else {
        deficit += leftArea;
        surplus += rightArea;
      }
    }
  }
  return { surplus, deficit };
}

function crashOnset(dayPoints, firstDoseMin) {
  if (firstDoseMin == null) return null;
  for (let i = 1; i < dayPoints.length; i += 1) {
    const prev = dayPoints[i - 1];
    const curr = dayPoints[i];
    if (curr.minute < firstDoseMin) continue;
    if (prev.D >= 0 && curr.D < 0) {
      const span = curr.minute - prev.minute;
      const u = prev.D === curr.D ? 1 : prev.D / (prev.D - curr.D);
      return Math.max(firstDoseMin, prev.minute + u * span);
    }
  }
  return null;
}

function dosesOnDate(doses, date) {
  return doses
    .filter((dose) => dose.date === date && Number(dose.amount_mg) > 0 && parseTime(dose.time) != null)
    .sort((a, b) => parseTime(a.time) - parseTime(b.time));
}

export function findReset(doses, settings) {
  const dated = doses.filter((dose) => dose.date && Number(dose.amount_mg) > 0 && parseTime(dose.time) != null);
  if (dated.length === 0) return { kind: "always" };
  let last = dated[0].date;
  for (const dose of dated) if (dose.date > last) last = dose.date;
  // Only the last dose still matters: earlier caffeine has already left the K-day window.
  const scanStart = last;
  const scanEnd = addDays(last, settings.history_days + 20);
  const model = prepare(doses, settings, addDays(scanStart, -settings.history_days), scanEnd, 15);
  let trailing = null;
  let everHigh = false;
  for (let date = scanStart; date <= scanEnd; date = addDays(date, 1)) {
    let maxB = 0;
    for (let minute = 0; minute < 1440; minute += 15) {
      maxB = Math.max(maxB, readPoint(model, date, minute).B);
    }
    if (maxB >= 1) {
      everHigh = true;
      trailing = null;
    } else if (trailing == null) trailing = date;
  }
  if (!everHigh || trailing == null) return { kind: "always" };
  return { kind: "date", date: trailing };
}

export function analyzeDate(doses, settings, date, clockMinute = null) {
  const step = 5;
  const windowStart = parseTime(settings.window_start);
  const windowEnd = parseTime(settings.window_end);
  const bedtime = parseTime(settings.bedtime);
  const historyDays = settings.history_days;
  const model = prepare(doses, settings, addDays(date, -historyDays), date, step);

  const windowPoints = [];
  for (let minute = windowStart; minute <= windowEnd; minute += step) {
    windowPoints.push(readPoint(model, date, minute));
  }
  const dayPoints = [];
  for (let minute = 0; minute <= 1440; minute += step) {
    dayPoints.push(readPoint(model, date, minute));
  }

  const todays = dosesOnDate(doses, date);
  let peak = { mg: 0, minute: 0 };
  const consider = (minute, mg) => {
    if (minute < 0 || minute > 1440) return;
    if (mg > peak.mg) peak = { mg, minute };
  };
  for (const point of dayPoints) consider(point.minute, point.L);
  for (const dose of todays) {
    const minute = parseTime(dose.time);
    consider(minute, directLevel(model, date, minute));
    if (settings.absorption_mode === "first-order") {
      consider(minute + settings.tmax_h * 60, directLevel(model, date, minute + settings.tmax_h * 60));
    }
  }

  const areas = integrateGaps(windowPoints);
  let largestDeficit = null;
  for (const point of windowPoints) {
    if (point.D < 0 && (largestDeficit == null || point.D < largestDeficit.mg)) {
      largestDeficit = { mg: point.D, minute: point.minute };
    }
  }

  const history = [];
  for (let k = 1; k <= historyDays; k += 1) {
    const day = addDays(date, -k);
    const points = [];
    for (let minute = windowStart; minute <= windowEnd; minute += step) {
      points.push({ minute, L: readL(model, day, minute) });
    }
    history.push({ daysAgo: k, weight: model.weights[k - 1], points });
  }

  const totalMg = todays.reduce((sum, dose) => sum + Number(dose.amount_mg), 0);
  const firstDoseMin = todays.length ? parseTime(todays[0].time) : null;
  const markers = todays.map((dose) => {
    const minute = parseTime(dose.time);
    return {
      minute,
      amount: Number(dose.amount_mg),
      label: dose.label || "",
      status: dose.status === "planned" ? "planned" : "taken",
      L: directLevel(model, date, minute),
    };
  });
  let now = null;
  if (clockMinute != null) {
    const minute = Math.max(0, Math.min(1440, Math.round(clockMinute / 5) * 5));
    now = readPoint(model, date, minute);
  }

  return {
    points: windowPoints,
    history,
    markers,
    totalMg,
    doseCount: todays.length,
    peak,
    bedtime: { minute: bedtime, mg: directLevel(model, date, bedtime) },
    surplusMgH: areas.surplus,
    deficitMgH: areas.deficit,
    largestDeficit,
    crashOnsetMinute: crashOnset(dayPoints, firstDoseMin),
    reset: findReset(doses, settings),
    now,
  };
}
