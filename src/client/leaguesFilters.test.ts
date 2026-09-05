/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesTaskFilters, TASK_FILTER_ALL } from './leaguesFilters.js';

const all = { region: TASK_FILTER_ALL, difficulty: TASK_FILTER_ALL, activityType: TASK_FILTER_ALL };
const task = { region: 'Karamja', difficulty: 'Easy', activityType: 'Combat/Magic' };

test('matchesTaskFilters is true when every dimension is All', () => {
  assert.equal(matchesTaskFilters(task, all), true);
});

test('matchesTaskFilters requires each narrowed dimension to match', () => {
  assert.equal(matchesTaskFilters(task, { ...all, region: 'Karamja' }), true);
  assert.equal(matchesTaskFilters(task, { ...all, region: 'Misthalin' }), false);
  assert.equal(matchesTaskFilters(task, { ...all, difficulty: 'Hard' }), false);
  assert.equal(matchesTaskFilters(task, { region: 'Karamja', difficulty: 'Easy', activityType: 'Skilling' }), false);
});
