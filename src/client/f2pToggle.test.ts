/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggledMembersFilter } from './f2pToggle.js';

test('turning the toggle on always selects f2p', () => {
  assert.equal(toggledMembersFilter('all', 'all'), 'f2p');
  assert.equal(toggledMembersFilter('members', 'members'), 'f2p');
});

test('turning it off restores what was selected before', () => {
  assert.equal(toggledMembersFilter('f2p', 'all'), 'all');
  assert.equal(toggledMembersFilter('f2p', 'members'), 'members');
});

test("a remembered 'f2p' falls back to all so the button is never a no-op", () => {
  assert.equal(toggledMembersFilter('f2p', 'f2p'), 'all');
});
