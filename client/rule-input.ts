import type { CleanupRule } from "../shared/types";

export interface RuleInput {
  ageEnabled: boolean;
  days: string;
  keepEnabled: boolean;
  keep: string;
}

export function readRule(input: RuleInput): { rule: CleanupRule; error: string | null } {
  const rule: CleanupRule = { olderThanDays: null, keepPerProject: null };
  for (const field of [
    { enabled: input.ageEnabled, value: input.days, key: "olderThanDays" as const, max: 36500, name: "Days" },
    { enabled: input.keepEnabled, value: input.keep, key: "keepPerProject" as const, max: 10000, name: "Retention count" },
  ]) {
    if (!field.enabled) continue;
    const value = field.value.trim();
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > field.max) {
      return { rule, error: `${field.name} must be a whole number from 1 to ${field.max}.` };
    }
    rule[field.key] = number;
  }
  return { rule, error: null };
}

export function ruleInput(rule: CleanupRule): RuleInput {
  return {
    ageEnabled: rule.olderThanDays !== null,
    days: String(rule.olderThanDays ?? 30),
    keepEnabled: rule.keepPerProject !== null,
    keep: String(rule.keepPerProject ?? 5),
  };
}
