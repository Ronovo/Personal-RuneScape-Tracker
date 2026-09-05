import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupQuestMeta } from './questmeta.js';

test('lookupQuestMeta resolves a real quest, case- and space-insensitively', () => {
  const cooks = lookupQuestMeta("Cook's Assistant");
  assert.ok(cooks);
  assert.equal(cooks.kind, 'quest');
  assert.equal(cooks.members, false);
  assert.deepEqual(lookupQuestMeta('  cook\'s assistant  '), cooks);
});

// RuneLite sends the ten Recipe for Disaster chapters as "Recipe for Disaster -
// Evil Dave". The wiki files those as subpages, which the scrape drops, so the
// chapter has to inherit the parent quest's classification. This is the
// trickiest lookup in the app and had no test.
test('a Recipe for Disaster chapter inherits the parent quest', () => {
  const parent = lookupQuestMeta('Recipe for Disaster');
  const chapter = lookupQuestMeta('Recipe for Disaster - Evil Dave');
  assert.ok(parent, 'the parent quest is in the scrape');
  assert.deepEqual(chapter, parent);
});

test('the dash fallback only applies to a real parent, not to any dashed name', () => {
  assert.equal(lookupQuestMeta('Not A Quest - With A Dash'), null);
  assert.equal(lookupQuestMeta('Some Quest Released Last Week'), null);
  // A leading dash has no parent to fall back to.
  assert.equal(lookupQuestMeta(' - Evil Dave'), null);
});
