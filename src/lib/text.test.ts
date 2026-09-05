import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitalize, titleCaseSlug } from './text.js';

// One helper now covers what were three near-identical private copies, so the
// two slug dialects it has to serve are pinned here.
test('titleCaseSlug handles the SCREAMING_SNAKE varbit/area dialect', () => {
  assert.equal(titleCaseSlug('WESTERN_PROVINCES', '_'), 'Western Provinces');
  assert.equal(titleCaseSlug('ARDOUGNE', '_'), 'Ardougne');
  assert.equal(titleCaseSlug('ABBERANT_SPECTRE_KILLCOUNT_1', '_'), 'Abberant Spectre Killcount 1');
});

test('titleCaseSlug handles the kebab-case task-id dialect', () => {
  assert.equal(titleCaseSlug('client-of-kourend', '-'), 'Client Of Kourend');
  assert.equal(titleCaseSlug('250-total-level', '-'), '250 Total Level');
});

test('titleCaseSlug normalises mixed case rather than trusting the input', () => {
  assert.equal(titleCaseSlug('mIxEd_CaSe', '_'), 'Mixed Case');
});

test('capitalize leaves the tail alone', () => {
  assert.equal(capitalize('elite'), 'Elite');
  assert.equal(capitalize('GP'), 'GP');
  assert.equal(capitalize(''), '');
});
