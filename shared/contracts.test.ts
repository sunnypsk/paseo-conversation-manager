import assert from "node:assert/strict";
import test from "node:test";
import { preferences, ruleSchema } from "./contracts.js";

test("fresh settings are manual and have no automatic project selection", () => {
  const settings = preferences.schema.parse({});
  assert.equal(settings.automatic, false);
  assert.deepEqual(settings.projectIds, []);
});

test("automatic cleanup requires a concrete retention rule", () => {
  assert.equal(preferences.schema.safeParse({
    automatic: true, rule: { olderThanDays: null, keepPerProject: null },
  }).success, false);
  assert.equal(preferences.schema.safeParse({
    automatic: true, rule: { olderThanDays: null, keepPerProject: 5 },
  }).success, true);
});

test("retention rules reject fractional, zero, negative and unbounded inputs", () => {
  for (const value of [0, -1, 1.5, Infinity, NaN, 100000]) {
    assert.equal(ruleSchema.safeParse({ olderThanDays: value, keepPerProject: 5 }).success, false);
    assert.equal(ruleSchema.safeParse({ olderThanDays: 30, keepPerProject: value }).success, false);
  }
});
