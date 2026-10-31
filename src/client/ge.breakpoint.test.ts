/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, loadPage, runScript, settle } from './pageHarness.test.js';

test('crossing the phone breakpoint keeps the nearest grid size and reloads', async () => {
  const page = loadPage('ge.html', {
    mobile: true,
    routes: {
      'GET /api/auth/status': { body: { mode: 'guest', accounts: false } },
      'GET /api/ge/movers': { body: { risers: [], consideredCount: 0 } },
    },
  });
  await runScript(page, './ge.js');
  const select = byId<HTMLSelectElement>(page, 'gridSize');
  const limits = () => page.requests.filter((r) => r.url.startsWith('/api/ge/movers'))
    .map((r) => new URLSearchParams(r.url.split('?')[1]).get('limit'));
  select.value = '6';
  select.dispatchEvent(new page.window.Event('change'));
  await settle();

  page.media.matches = false;
  page.media.dispatchEvent(new page.window.Event('change'));
  await settle();
  assert.deepEqual([...select.options].map((o) => o.value), ['5', '10', '25', '50']);
  assert.equal(select.value, '5');

  page.media.matches = true;
  page.media.dispatchEvent(new page.window.Event('change'));
  await settle();
  assert.equal(select.value, '6');
  assert.deepEqual(limits(), ['24', '6', '5', '6']);
});
