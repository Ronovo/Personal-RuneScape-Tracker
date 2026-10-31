/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, loadPage } from './pageHarness.test.js';
import { render } from './chart.js';

const START = Date.UTC(2026, 8, 5, 12) / 1000;

function point(i: number, high: number | null, low: number | null, buy: number | null = 10, sell: number | null = 5) {
  return { timestamp: START + i * 3600, avgHighPrice: high, avgLowPrice: low, highPriceVolume: buy, lowPriceVolume: sell };
}

const POINTS = [point(0, 1000, 900), point(1, 1050, null), point(2, 1100, 950), point(3, 1080, 940)];

function chart(css = ''): HTMLElement {
  const page = loadPage('item.html');
  if (css) {
    const style = page.window.document.createElement('style');
    style.textContent = css;
    page.window.document.head.append(style);
  }
  return byId(page, 'chart');
}

function count(el: HTMLElement, selector: string): number {
  return el.querySelectorAll(selector).length;
}

function pathPoints(el: HTMLElement, selector: string): number {
  return (el.querySelector(selector)!.getAttribute('d')!.match(/[ML] /g) ?? []).length;
}

test('no points says there is no history', () => {
  const el = chart();
  render(el);
  assert.equal(el.textContent, 'No price history for this range.');
});

test('both prices draw a line, a shaded area and an end dot, with the spread between them filled', () => {
  const el = chart();
  render(el, { points: POINTS, rangeHigh: 1100, rangeLow: 900, rangeAvg: 1000 });
  assert.equal(pathPoints(el, 'path.chart-high'), 4);
  assert.equal(pathPoints(el, 'path.chart-low'), 4);
  assert.equal(count(el, 'path[fill^="url(#chartArea"]'), 2);
  assert.equal(count(el, 'polygon'), 1);
  assert.equal(count(el, 'circle[r="4.5"]'), 2);
  assert.equal(count(el, '.chart-vol-buy, .chart-vol-line'), 0);
  const guides = [...el.querySelectorAll('text')].map((t) => t.textContent).filter((t) => /^(High|Avg|Low) /.test(t!));
  assert.deepEqual(guides, ['High 1.1k', 'Avg 1.0k', 'Low 900']);
  assert.equal(el.querySelector('.chart-tooltip')!.hasAttribute('hidden'), true);
  assert.doesNotMatch(el.innerHTML, /NaN|undefined/);
});

test('a gap inside a series is bridged, and gaps at the ends shorten the line', () => {
  const el = chart();
  render(el, { points: [point(0, null, 900), point(1, 1000, null), point(2, null, null), point(3, 1200, 950), point(4, null, 960)] });
  assert.equal(pathPoints(el, 'path.chart-high'), 3);
  assert.equal(pathPoints(el, 'path.chart-low'), 5);
  assert.equal(count(el, 'polygon'), 1);
});

test('a series with one known price is a dot, and a missing series draws nothing', () => {
  const el = chart();
  render(el, { points: [point(0, null, null), point(1, 1000, null), point(2, null, null)] });
  assert.equal(count(el, 'path.chart-high, path.chart-low, polygon'), 0);
  assert.equal(count(el, 'circle[r="3"]'), 1);
  assert.equal(count(el, 'circle[r="4.5"]'), 1);
});

test('one point draws a dot for each price and no volume line', () => {
  const el = chart();
  render(el, { points: [point(0, 1000, 900)], series: { volume: true } });
  assert.equal(count(el, 'circle[r="3"]'), 2);
  assert.equal(el.querySelector('.chart-vol-buy')!.getAttribute('width'), '6.0');
  assert.equal(count(el, '.chart-vol-line'), 0);
});

test('a flat price still gets an axis', () => {
  const el = chart();
  render(el, { points: [point(0, 500, 500), point(1, 500, 500)] });
  assert.ok(count(el, 'text.chart-axis') > 2);
  assert.doesNotMatch(el.innerHTML, /NaN|Infinity/);
});

test('a wide price range rounds its axis up to the next power of ten', () => {
  const el = chart();
  render(el, { points: [point(0, 900, 100), point(1, 900, 100)] });
  const axis = [...el.querySelectorAll('text[text-anchor="end"]')].map((t) => t.textContent);
  assert.deepEqual(axis, ['0', '200', '400', '600', '800', '1.0k']);
});

test('volume bars split buy and sell, mark empty buckets on the baseline, and get their own axis', () => {
  const el = chart();
  render(el, {
    points: [point(0, 1000, 900, 10, 0), point(1, 1000, 900, 0, 5), point(2, 1000, 900, null, null), point(3, 1000, 900, 4, 4)],
    series: { volume: true },
  });
  assert.equal(count(el, '.chart-vol-buy'), 2);
  assert.equal(count(el, '.chart-vol-sell'), 2);
  assert.equal(count(el, '.chart-vol-zero'), 1);
  assert.equal(pathPoints(el, '.chart-vol-line'), 4);
  const volAxis = [...el.querySelectorAll('text[font-size="10"]')].map((t) => t.textContent);
  assert.deepEqual(volAxis, ['0', '5', '10']);
});

test('hiding both prices leaves the volume, scaled against whichever price is known', () => {
  const el = chart();
  render(el, { points: [point(0, null, 900), point(1, 1000, null)], series: { high: false, low: false, volume: true }, rangeHigh: 5000 });
  assert.equal(count(el, 'path.chart-high, path.chart-low, polygon, circle[r="4.5"]'), 0);
  assert.equal(count(el, '.chart-vol-buy'), 2);
  assert.equal([...el.querySelectorAll('text')].some((t) => t.textContent?.startsWith('High ')), false);
});

test('the smoothed line follows the insta-buy, or the insta-sell when insta-buy is hidden', () => {
  const smoothed = chart();
  render(smoothed, { points: POINTS, series: { smooth: true } });
  assert.equal(count(smoothed, 'path[stroke-dasharray="4 3"]'), 1);

  const sellOnly = chart();
  render(sellOnly, { points: POINTS, series: { smooth: true, high: false } });
  assert.equal(count(sellOnly, 'path[stroke-dasharray="4 3"]'), 1);
  assert.equal(count(sellOnly, 'path.chart-high'), 0);

  const single = chart();
  render(single, { points: [point(0, 1000, 900)], series: { smooth: true } });
  assert.equal(count(single, 'path[stroke-dasharray="4 3"]'), 0);
});

test('the time axis reads as hours for a day, days for a week or month, and months for a year', () => {
  const hourly = Array.from({ length: 31 }, (_, i) => point(i, 1000 + i, 900));
  for (const [range, ticks, pattern] of [
    ['1d', 6, /^\d{1,2}:\d{2}\s?[AP]M$/], ['1w', 7, /^Sep \d{1,2}$/], ['1m', 6, /^Sep \d{1,2}$/], ['1y', 6, /^Sep 26$/],
  ] as const) {
    const el = chart();
    render(el, { points: hourly, range });
    const labels = [...el.querySelectorAll('text[text-anchor="middle"]')].map((t) => t.textContent!);
    assert.equal(labels.length, ticks, range);
    assert.match(labels[0]!, pattern, range);
  }
});

test('the last point always gets a time label, even off the regular step', () => {
  const el = chart();
  const points = Array.from({ length: 12 }, (_, i) => point(i, 1000 + i, 900));
  render(el, { points, range: '1d' });
  const labels = [...el.querySelectorAll('text[text-anchor="middle"]')].map((t) => t.textContent!);
  assert.equal(labels.length, 7);
  assert.equal(labels[6], new Date(points[11]!.timestamp * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
});

test('the smoothed line starts where there are prices to average', () => {
  const el = chart();
  const points = [null, null, null, null, 1000, 1010, 1020, 1030].map((high, i) => point(i, high, 900));
  render(el, { points, series: { smooth: true } });
  assert.equal(pathPoints(el, 'path[stroke-dasharray="4 3"]'), 7);
});

test('a history with volume but no prices still draws its axes and bars', () => {
  const el = chart();
  render(el, { points: [point(0, null, null, 5, 5), point(1, null, null, 3, 2)], series: { volume: true } });
  assert.doesNotMatch(el.innerHTML, /NaN|Infinity/);
  assert.equal(count(el, '.chart-vol-buy'), 2);
  assert.ok(count(el, 'text.chart-axis') > 2);
});

test('colours come from the page theme when it sets them', () => {
  const themed = chart(':root { --up: #123456; }');
  render(themed, { points: POINTS });
  assert.equal(themed.querySelector('path.chart-high')!.getAttribute('stroke'), '#123456');
  const plain = chart();
  render(plain, { points: POINTS });
  assert.equal(plain.querySelector('path.chart-high')!.getAttribute('stroke'), '#6fbf6f');
});

test('pointing at the chart shows the nearest point, and leaving hides it', () => {
  const el = chart();
  render(el, { points: POINTS, series: { volume: true } });
  const svg = el.querySelector('svg')!;
  const tip = el.querySelector<HTMLElement>('.chart-tooltip')!;
  const hair = el.querySelector('.chart-crosshair')!;
  const box = (() => ({ left: 0, width: 800 })) as unknown as () => DOMRect;
  let screen: { inverse(): { scale: number } } | null = null;
  Object.assign(svg, {
    createSVGPoint: () => ({
      x: 0, y: 0,
      matrixTransform(this: { x: number }, m: { scale: number }) { return { x: this.x * m.scale }; },
    }),
    getScreenCTM: () => screen,
    getBoundingClientRect: box,
  });
  el.getBoundingClientRect = box;
  const plotLeft = 64;
  const step = (800 - 52 - 64) / 3;

  svg.onpointermove!.call(svg, { clientX: plotLeft + step + 5 } as PointerEvent);
  assert.equal(tip.hidden, false);
  assert.equal(hair.getAttribute('visibility'), 'visible');
  assert.equal(Number(hair.getAttribute('x1')), plotLeft + step);
  const lines = [...tip.querySelectorAll('div')].map((d) => d.textContent);
  assert.deepEqual(lines, ['Insta-buy: 1,050 gp', 'Insta-sell: n/a', 'Buy vol: 10', 'Sell vol: 5', 'Total vol: 15']);
  assert.equal(tip.style.left, `${plotLeft + step + 12}px`);

  screen = { inverse: () => ({ scale: 2 }) };
  svg.onpointermove!.call(svg, { clientX: 800 / 2 } as PointerEvent);
  assert.equal(Number(hair.getAttribute('x1')), plotLeft + 3 * step);
  assert.equal(tip.style.left, '640px');

  svg.onpointerleave!.call(svg, {} as PointerEvent);
  assert.equal(tip.hidden, true);
  assert.equal(hair.getAttribute('visibility'), 'hidden');
});
