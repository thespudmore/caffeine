import assert from "node:assert/strict";
import test from "node:test";
import { dosesToCsv, parseBackup, parseCsv } from "../js/csv.js";

test("csv export round-trips doses", () => {
  const doses = [{
    id: "a",
    date: "2026-06-01",
    time: "09:00",
    amount_mg: 189,
    label: "Dare mocha, 750 ml",
    status: "taken",
    duration_min: 0,
    notes: "",
  }, {
    id: "b",
    date: "2026-06-02",
    time: "14:15",
    amount_mg: 36.5,
    label: '=half',
    status: "planned",
    duration_min: 20,
    notes: "sip",
  }];
  const parsed = parseCsv(dosesToCsv(doses));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.doses.length, 2);
  assert.equal(parsed.doses[0].amount_mg, 189);
  assert.equal(parsed.doses[1].status, "planned");
  assert.equal(parsed.doses[1].label, "=half");
  assert.equal(parsed.doses[1].duration_min, 20);
  assert.equal(parsed.doses[1].notes, "sip");
});

test("json backup keeps settings and drops broken rows", () => {
  const backup = parseBackup(JSON.stringify({
    version: 1,
    settings: { half_life_h: 5.5, carry_overnight: false, absorption_mode: "instant" },
    doses: [
      { id: "ok", date: "2026-06-01", time: "10:00", amount_mg: 40, status: "taken" },
      { date: "nope", time: "10:00", amount_mg: 40 },
    ],
  }));
  assert.equal(backup.doses.length, 1);
  assert.equal(backup.settings.half_life_h, 5.5);
  assert.equal(backup.settings.carry_overnight, false);
  assert.equal(backup.settings.absorption_mode, "instant");
});
