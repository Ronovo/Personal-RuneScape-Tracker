/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_COLUMN_KEYS, COLUMNS, FACTORY_DEFAULT_COLUMNS, cardCellsHtml, columnCellsHtml,
  columnHeadersHtml, columnsPanelHtml, confidenceDotHtml, sortOptionsHtml, visibleColumnCount,
} from './flipColumns.js';
import type { ColumnKey } from './flipColumns.js';
import { FLIP_SORTS } from './types.js';
import type { FlipItem } from './types.js';

const ROW: FlipItem = {
  id: 4151, name: 'Abyssal whip', members: true, icon: 'whip.png',
  buy: 1_500_000, sell: 1_560_000, margin: 60_000, tax: 31_200, taxExempt: false,
  profit: 28_800, roi: 1.92, limit: 70, profitPerLimit: 2_016_000, capital: 105_000_000,
  volume24h: 12_345, buyPressure: 0.5, age: 420, highTime: 1, lowTime: 1,
  marginVsAvg: 1.34, gpPerHour: 504_000, score: 61,
  confidence: 'high', confidenceWhy: 'volume ≥ 10k · fresh · typical margin',
  realisticProfit: 288_000,
};

// A thin market: no limit, no 24h average to compare against, never traded.
const EMPTY_ROW: FlipItem = {
  ...ROW,
  id: 2, name: 'Nothing', limit: null, profitPerLimit: null, capital: null,
  marginVsAvg: null, gpPerHour: null, age: null, roi: null,
  confidence: 'low', confidenceWhy: '', realisticProfit: undefined,
};

test('the descriptor is the only column list: keys and factory defaults derive from it', () => {
  assert.deepEqual(ALL_COLUMN_KEYS, COLUMNS.map((c) => c.key));
  assert.equal(new Set(ALL_COLUMN_KEYS).size, ALL_COLUMN_KEYS.length, 'no duplicate keys');
  for (const key of FACTORY_DEFAULT_COLUMNS) {
    assert.ok(ALL_COLUMN_KEYS.includes(key), `${key} is a real column`);
  }
});

// Every header is clickable to sort, so every key has to be one the server
// accepts - otherwise the click sends a sort the API silently ignores.
test('every column sorts by a key the server accepts', () => {
  for (const key of ALL_COLUMN_KEYS) {
    assert.ok(FLIP_SORTS.includes(key), `${key} is not in FLIP_SORTS`);
  }
});

test('a fully populated row renders every cell', () => {
  const html = columnCellsHtml(ROW, { bankrollOn: true });
  assert.equal((html.match(/<td /g) ?? []).length, COLUMNS.length);
  assert.match(html, /<td data-col="buy">1,500,000 gp<\/td>/);
  assert.match(html, /<td data-col="roi" class="pct up">\+1\.9%<\/td>/);
  assert.match(html, /<td data-col="marginVsAvg">1\.34×<\/td>/);
  assert.match(html, /<td data-col="gpPerHour">~504k<\/td>/);
});

// Nulls arrive constantly from the prices API - a one-sided book, an item with
// no buy limit, a market that hasn't traded. No cell may render "null" or NaN.
test('every formatter degrades to n/a rather than null or NaN', () => {
  const html = columnCellsHtml(EMPTY_ROW, { bankrollOn: false });
  assert.ok(!html.includes('null'), html);
  assert.ok(!html.includes('NaN'), html);
  assert.ok(!html.includes('undefined'), html);
});

test('a negative ROI colours down, and a null one gets no direction at all', () => {
  assert.match(columnCellsHtml({ ...ROW, roi: -4 }, { bankrollOn: true }), /class="pct down"/);
  assert.match(columnCellsHtml(EMPTY_ROW, { bankrollOn: true }), /data-col="roi" class="pct "/);
});

// Realistic Profit is derived from a bankroll the scan may not have.
test('Realistic Profit is only a number once a bankroll is set', () => {
  assert.match(columnCellsHtml(ROW, { bankrollOn: true }), /data-col="realisticProfit">288k</);
  assert.match(columnCellsHtml(ROW, { bankrollOn: false }), /data-col="realisticProfit">n\/a</);
});

// The one column whose value comes from item-authored text.
test('the confidence dot escapes its tooltip', () => {
  const nasty = { ...ROW, confidenceWhy: '"><script>alert(1)</script>' };
  const html = confidenceDotHtml(nasty);
  assert.ok(!html.includes('<script>'), html);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
  assert.match(html, /class="conf-dot conf-high"/);
});

test('a blank reason falls back to the confidence level itself', () => {
  assert.match(confidenceDotHtml(EMPTY_ROW), /title="low"/);
});

test('headers and cells stay in the same order, so the table lines up', () => {
  const keyOrder = (html: string, tag: string): string[] =>
    [...html.matchAll(new RegExp(`<${tag} data-col="([^"]+)"`, 'g'))].map((m) => m[1]!);

  assert.deepEqual(keyOrder(columnHeadersHtml(), 'th'), ALL_COLUMN_KEYS);
  assert.deepEqual(keyOrder(columnCellsHtml(ROW, { bankrollOn: true }), 'td'), ALL_COLUMN_KEYS);
});

test('a column filter drops the same columns from the header and the cells', () => {
  const visible = (key: ColumnKey): boolean => key === 'buy' || key === 'sell';
  assert.equal(visibleColumnCount(visible), 2);
  assert.equal((columnHeadersHtml(visible).match(/<th /g) ?? []).length, 2);

  const cells = columnCellsHtml(ROW, { bankrollOn: true }, visible);
  assert.equal((cells.match(/<td /g) ?? []).length, 2);
  assert.ok(!cells.includes('data-col="tax"'));
});

// The mobile card is a curated subset, not the full table - but it comes from
// the same descriptor, so it can never format a value differently.
test('the card shows the onCard subset and reuses the table formatters', () => {
  const card = cardCellsHtml(ROW, { bankrollOn: true });
  const onCard = COLUMNS.filter((c) => c.onCard);
  assert.equal((card.match(/<dt>/g) ?? []).length, onCard.length);
  assert.ok(card.includes('1,500,000 gp'), 'same Buy formatting as the table');
  assert.ok(!card.includes('<dt>Tax</dt>'), 'Tax is table-only');
});

test('the card drops Realistic Profit entirely without a bankroll', () => {
  const withBankroll = cardCellsHtml(ROW, { bankrollOn: true });
  const without = cardCellsHtml(ROW, { bankrollOn: false });
  assert.ok(withBankroll.includes('<dt>Realistic</dt>'));
  assert.ok(!without.includes('<dt>Realistic</dt>'));
  assert.ok(!without.includes('n/a'), 'and does not leave an empty row behind');
});

test('the panel and sort dropdown cover every column exactly once', () => {
  const panel = columnsPanelHtml();
  const options = sortOptionsHtml();
  for (const key of ALL_COLUMN_KEYS) {
    assert.equal((panel.match(new RegExp(`data-col="${key}"`, 'g')) ?? []).length, 1, key);
    assert.equal((options.match(new RegExp(`value="${key}"`, 'g')) ?? []).length, 1, key);
  }
  // The panel is a settings UI with room for the fuller name.
  assert.ok(panel.includes('Realistic Profit (bankroll)'));
  assert.ok(options.includes('>Realistic</option>'));
});

test('every column carries a tooltip, and the header uses the compact label', () => {
  const headers = columnHeadersHtml();
  for (const column of COLUMNS) {
    assert.ok(column.title.length > 10, `${column.key} has a real description`);
  }
  // shortLabel wins in the table, label everywhere there is room.
  assert.ok(headers.includes('>Vol/day</th>'));
  assert.ok(headers.includes('>×avg</th>'));
  assert.ok(sortOptionsHtml().includes('>Volume</option>'));
  assert.ok(sortOptionsHtml().includes('>Margin vs avg</option>'));
});
