/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, loadPage, runScript } from './pageHarness.test.js';

test('without accounts the account pages say so and show no forms', async () => {
  const page = loadPage('login.html', { routes: { 'GET /api/auth/status': { body: { mode: 'guest', accounts: false } } } });
  await runScript(page, './account.js');
  assert.equal(byId(page, 'loginForm').hidden, true);
  assert.ok(byId(page, 'loginLinks').hasAttribute('hidden'));
  assert.equal(byId(page, 'accountMessage').textContent, 'Accounts are not turned on for this server.');
});
