import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupCombatAchievementMeta } from './combatachievementmeta.js';
import { withTaskView, summarizeCombatAchievements } from './combatachievements.js';

test('lookupCombatAchievementMeta resolves a known varbit slug', () => {
  const meta = lookupCombatAchievementMeta('ABYSSALSIRE_KILLCOUNT_1');
  assert.ok(meta);
  assert.equal(meta!.name, 'Abyssal Adept');
  assert.equal(meta!.monster, 'Abyssal Sire');
});

test('withTaskView uses wiki metadata when available', () => {
  const view = withTaskView({ task: 'ABYSSALSIRE_KILLCOUNT_1', complete: true });
  assert.equal(view.name, 'Abyssal Adept');
  assert.equal(view.group, 'Abyssal Sire');
  assert.equal(view.groupKey, 'ABYSSALSIRE');
});

test('withTaskView falls back to title-case for unknown slugs', () => {
  const view = withTaskView({ task: 'NOT_A_REAL_CA_TASK', complete: false });
  assert.equal(view.name, 'Not A Real Ca Task');
  assert.equal(view.group, 'Not A Real Ca Task');
});

test('summarizeCombatAchievements counts completion and points', () => {
  const tasks = [
    withTaskView({ task: 'ABYSSALSIRE_KILLCOUNT_1', complete: true }),
    withTaskView({ task: 'NOT_A_REAL_CA_TASK', complete: false }),
  ];
  assert.deepEqual(summarizeCombatAchievements(tasks, 123), {
    points: 123,
    complete: 1,
    total: 2,
  });
});

// withTaskView's fallback splits an unknown varbit slug into "<monster>_<type>_<n>"
// so the row still groups by boss. Every way that parse can fail has to land on
// the whole slug as its own group rather than throwing or mis-grouping.
test('an unknown slug groups by its monster prefix when the shape is recognisable', () => {
  const view = withTaskView({ task: 'SOME_NEW_BOSS_KILLCOUNT_3', complete: false });
  assert.equal(view.groupKey, 'SOME_NEW_BOSS');
  assert.equal(view.group, 'Some New Boss');
  assert.equal(view.name, 'Some New Boss Killcount 3');
  assert.equal(view.tier, undefined, 'no wiki metadata to draw a tier from');
});

test('a slug the prefix rule cannot parse becomes its own group', () => {
  const cases: [string, string][] = [
    // Trailing token is not a number.
    ['SOME_BOSS_KILLCOUNT_X', 'SOME_BOSS_KILLCOUNT_X'],
    // Numbered, but the token before it is not a known task type.
    ['SOME_BOSS_WOMBAT_2', 'SOME_BOSS_WOMBAT_2'],
    // Index below 1.
    ['SOME_BOSS_KILLCOUNT_0', 'SOME_BOSS_KILLCOUNT_0'],
    // Nothing to split at all.
    ['SOLO', 'SOLO'],
  ];
  for (const [slug, expected] of cases) {
    const view = withTaskView({ task: slug, complete: true });
    assert.equal(view.groupKey, expected, slug);
    assert.equal(view.task, slug, slug);
  }
});

test('the type token is matched case-insensitively', () => {
  assert.equal(withTaskView({ task: 'A_BOSS_speed_1', complete: false }).groupKey, 'A_BOSS');
});
