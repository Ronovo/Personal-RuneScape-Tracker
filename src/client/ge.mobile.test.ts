/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, click, loadPage, runScript, settle, type Page } from './pageHarness.test.js';

const ROUTES = {
  'GET /api/auth/status': { body: { mode: 'guest', accounts: false } },
  'GET /api/ge/movers': { body: { risers: [], consideredCount: 0 } },
};

async function open(storage: Record<string, string> = {}): Promise<Page> {
  const page = loadPage('ge.html', { routes: ROUTES, storage, mobile: true });
  await runScript(page, './ge.js');
  return page;
}

function sizes(page: Page): { options: string[]; value: string } {
  const select = byId<HTMLSelectElement>(page, 'gridSize');
  return { options: [...select.options].map((o) => o.value), value: select.value };
}

function lastLimit(page: Page): string | null {
  const movers = page.requests.filter((r) => r.url.startsWith('/api/ge/movers'));
  const url = movers[movers.length - 1]!.url;
  return new URLSearchParams(url.split('?')[1]).get('limit');
}

function savedSize(size: string): Record<string, string> {
  return { osrs_ge_filters: JSON.stringify({ gridSize: size }) };
}

test('on a phone the grid sizes end on a full row of two', async () => {
  const page = await open();
  assert.deepEqual(sizes(page), { options: ['6', '10', '24', '50'], value: '24' });
  assert.equal(lastLimit(page), '24');
});

test('a size saved on a computer opens as its phone equivalent', async () => {
  const page = await open(savedSize('5'));
  assert.equal(sizes(page).value, '6');
  assert.equal(lastLimit(page), '6');
});

test('a size picked on a phone is still picked on the next visit', async () => {
  for (const size of ['6', '10', '24', '50']) {
    const page = await open(savedSize(size));
    assert.equal(sizes(page).value, size, `saved ${size}`);
    assert.equal(lastLimit(page), size, `saved ${size}`);
  }
});

test('a saved size that is not one of the sizes opens as the phone default', async () => {
  for (const size of ['7', 'many']) {
    const page = await open(savedSize(size));
    assert.equal(sizes(page).value, '24', `saved ${size}`);
    assert.equal(lastLimit(page), '24', `saved ${size}`);
  }
});

test('Reset on a phone leaves a grid size picked', async () => {
  const page = await open(savedSize('50'));
  click(page, 'resetBtn');
  await settle();
  assert.equal(lastLimit(page), '24');
  assert.equal(sizes(page).value, '24');
});
