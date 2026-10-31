/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { click, loadPage, runScript, settle } from './pageHarness.test.js';

test('on a phone, Return to item finds the item among the cards', async () => {
  const items = [1, 2].map((id) => ({
    id, name: `Item ${id}`, members: false, icon: '', buy: 100, sell: 120, margin: 20, tax: 2, taxExempt: false,
    profit: 18, roi: 18, limit: 10, profitPerLimit: 180, capital: 1000, volume24h: 500, buyPressure: null, age: 60,
    highTime: null, lowTime: null, marginVsAvg: null, gpPerHour: null, score: 50, confidence: 'medium',
    confidenceWhy: '',
  }));
  const page = loadPage('flip.html', {
    mobile: true,
    routes: {
      'GET /api/auth/status': { body: { mode: 'guest', accounts: false } },
      'GET /api/ge/flips': { body: { items, consideredCount: 2, page: 1, pageSize: 50, totalPages: 1 } },
    },
  });
  page.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
    this.dataset.scrolled = 'yes';
  };
  await runScript(page, './flip.js');
  page.window.document.querySelector('#flipCards .calc-btn[data-id="2"]')!
    .dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
  click(page, 'returnToItemBtn');
  await settle();
  const card = page.window.document.querySelector<HTMLElement>('#flipCards [data-item-id="2"]')!;
  assert.ok(card.classList.contains('return-target'));
  assert.equal(card.dataset.scrolled, 'yes');
  assert.equal(page.window.document.querySelector('#flipBody [data-item-id="2"]')!.classList.contains('return-target'), false);
});
