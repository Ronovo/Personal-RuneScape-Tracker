/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, runScript } from './pageHarness.test.js';

// With site data blocked, Chrome throws a SecurityError as soon as a script reads window.localStorage.
test('a browser that blocks site data still gets a working Grand Exchange page', async () => {
  const page = loadPage('ge.html', {
    routes: {
      'GET /api/auth/status': { body: { mode: 'guest', accounts: false } },
      'GET /api/ge/movers': {
        body: {
          risers: [{ id: 1, name: 'Riser', icon: '', members: false, currentPrice: 10, pctChange: 1, volume24h: 5,
            marginAfterTax: null }],
          consideredCount: 1,
        },
      },
    },
  });
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new page.window.DOMException(`Failed to read the '${name}' property from 'Window': Access is denied for this document.`, 'SecurityError');
      },
    });
  }
  await runScript(page, './ge.js');
  const names = [...page.window.document.querySelectorAll('#grid .name')].map((n) => n.textContent);
  assert.deepEqual(names, ['Riser']);
});
