// Hand-rolled SVG price chart. No library.
// Wiki points can have null prices (a bucket with no trades on that side).
// Interior gaps are bridged for display so the line stays connected; the
// tooltip still reports the raw wiki value (price n/a, volume 0) per bucket.

import { fmtGp, fmtGpShort, fmtTime } from './format.js';
import type { TimeseriesPoint, PriceRange } from './types.js';

const W = 800;
const H = 280;
const PAD = { top: 16, right: 16, bottom: 36, left: 64 };
interface SeriesFlags {
  high?: boolean;
  low?: boolean;
  volume?: boolean;
  smooth?: boolean;
}

interface RenderOptions {
  points?: TimeseriesPoint[];
  range?: PriceRange;
  series?: SeriesFlags;
  rangeHigh?: number | null;
  rangeLow?: number | null;
  rangeAvg?: number | null;
}

interface Coord {
  x: number;
  y: number;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Nice-number rounding so y-axis ticks land on 1/2/5 * 10^n instead of ugly floats.
function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range || 1));
  const frac = (range || 1) / 10 ** exp;
  let nice: number;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * 10 ** exp;
}

function niceTicks(min: number, max: number, count = 5): { ticks: number[]; niceMin: number; niceMax: number } {
  const range = niceNum(max - min || 1, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(v);
  return { ticks, niceMin, niceMax };
}

// X labels depend on the selected range: time-of-day for 1D, dates otherwise.
function formatX(ts: number, range: PriceRange): string {
  const d = new Date(ts * 1000);
  if (range === '1d') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (range === '1y') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// 7-point moving average overlay for the Smooth toggle. Skips nulls in the window.
function movingAverage(values: (number | null)[], window = 7): (number | null)[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i - half; j <= i + half; j++) {
      const v = values[j];
      if (j >= 0 && j < values.length && v != null) {
        sum += v;
        n++;
      }
    }
    return n ? sum / n : null;
  });
}

// Linearly bridge every null run that has a real value on both sides, so a
// wiki hole doesn't read as a broken line. Leading and trailing nulls have
// only one anchor and stay unplotted - a lone real point beside them is drawn
// as a dot. Tooltips still report the raw wiki values the caller passed in.
function bridgeGaps(values: (number | null)[]): (number | null)[] {
  const out = values.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i] != null) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j] == null) j++;
    const gapLen = j - i;
    const left = i > 0 ? out[i - 1]! : null;
    const right = j < out.length ? out[j]! : null;
    if (left != null && right != null) {
      for (let k = i; k < j; k++) {
        const t = (k - i + 1) / (gapLen + 1);
        out[k] = left + (right - left) * t;
      }
    }
    i = j;
  }
  return out;
}

// Split a series wherever display data still has a gap after bridging.
function coordSegments(coords: (Coord | null)[]): Coord[][] {
  const segs: Coord[][] = [];
  let cur: Coord[] = [];
  for (const c of coords) {
    if (c == null) {
      if (cur.length) segs.push(cur);
      cur = [];
    } else {
      cur.push(c);
    }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

// Straight segments suit GE step data better than cubic splines.
function linePath(coords: Coord[]): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) return '';
  let d = `M ${coords[0]!.x.toFixed(1)},${coords[0]!.y.toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    d += ` L ${coords[i]!.x.toFixed(1)},${coords[i]!.y.toFixed(1)}`;
  }
  return d;
}

function areaPath(coords: Coord[], baseline: number): string {
  if (coords.length < 2) return '';
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  let d = `M ${first.x.toFixed(1)},${baseline.toFixed(1)} L ${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    d += ` L ${coords[i]!.x.toFixed(1)},${coords[i]!.y.toFixed(1)}`;
  }
  d += ` L ${last.x.toFixed(1)},${baseline.toFixed(1)} Z`;
  return d;
}

// Fill band between high and low, also broken at gaps so it doesn't span missing data.
function bandPolygons(highCoords: (Coord | null)[], lowCoords: (Coord | null)[]): string[] {
  const polys: string[] = [];
  let hi: Coord[] = [];
  let lo: Coord[] = [];
  const flush = () => {
    if (hi.length >= 2 && lo.length >= 2) {
      const points = [...hi, ...lo.reverse()].map((c) => `${c.x},${c.y}`).join(' ');
      polys.push(points);
    }
    hi = [];
    lo = [];
  };
  const n = Math.max(highCoords.length, lowCoords.length);
  for (let i = 0; i < n; i++) {
    const h = highCoords[i];
    const l = lowCoords[i];
    if (h && l) {
      hi.push(h);
      lo.push(l);
    } else {
      flush();
    }
  }
  flush();
  return polys;
}

function lastCoord(coords: (Coord | null)[]): Coord | null {
  for (let i = coords.length - 1; i >= 0; i--) {
    const coord = coords[i];
    if (coord) return coord;
  }
  return null;
}

interface RangeGuide {
  value: number;
  label: string;
  color: string;
}

function rangeGuides(
  rangeHigh: number | null | undefined,
  rangeAvg: number | null | undefined,
  rangeLow: number | null | undefined,
  yAt: (v: number) => number,
  plotLeft: number,
  plotRight: number,
  labelX: number,
  muted: string,
  up: string,
  down: string,
  gold: string
): string {
  const guides: RangeGuide[] = [];
  if (rangeHigh != null) guides.push({ value: rangeHigh, label: 'High', color: up });
  if (rangeAvg != null) guides.push({ value: rangeAvg, label: 'Avg', color: gold });
  if (rangeLow != null) guides.push({ value: rangeLow, label: 'Low', color: down });

  return guides.map(({ value, label, color }) => {
    const y = yAt(value);
    return `<line x1="${plotLeft}" y1="${y.toFixed(1)}" x2="${plotRight}" y2="${y.toFixed(1)}"
        stroke="${color}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4 5" />
      <text class="chart-axis" x="${labelX}" y="${(y + 3).toFixed(1)}" text-anchor="start"
        fill="${muted}" font-size="10" opacity="0.85">${label} ${fmtGpShort(value)}</text>`;
  }).join('');
}

function segmentMarkup(
  segs: Coord[][],
  stroke: string,
  className: string,
  baseline: number,
  areaGradId: string
): { lines: string; areas: string; dots: string } {
  const lines: string[] = [];
  const areas: string[] = [];
  const dots: string[] = [];
  for (const s of segs) {
    const path = linePath(s);
    if (path) {
      lines.push(`<path class="${className}" d="${path}" fill="none" stroke="${stroke}" stroke-width="2.25" ${STROKE} vector-effect="non-scaling-stroke" />`);
      const area = areaPath(s, baseline);
      if (area) areas.push(`<path d="${area}" fill="url(#${areaGradId})" stroke="none" />`);
    } else if (s.length === 1) {
      const p = s[0]!;
      dots.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${stroke}" stroke="${stroke}" stroke-opacity="0.35" stroke-width="4" />`);
    }
  }
  return { lines: lines.join(''), areas: areas.join(''), dots: dots.join('') };
}

const STROKE = 'stroke-linejoin="round" stroke-linecap="round"';

// series.high / .low / .volume / .smooth are checkbox flags from item.ts.
export function render(el: HTMLElement, {
  points = [],
  range = '1w',
  series = {},
  rangeHigh = null,
  rangeLow = null,
  rangeAvg = null
}: RenderOptions = {}): void {
  const showHigh = series.high !== false;
  const showLow = series.low !== false;
  const showVol = Boolean(series.volume);
  const showSmooth = Boolean(series.smooth);

  const up = cssVar('--up', '#6fbf6f');
  const down = cssVar('--down', '#d97a6a');
  const muted = cssVar('--muted', '#a89a80');
  const gold = cssVar('--gold', '#d9c27e');
  const border = cssVar('--border', '#4a3f2f');
  const text = cssVar('--text', '#e8e0d0');

  if (!points.length) {
    el.innerHTML = '<p class="status">No price history for this range.</p>';
    return;
  }

  const highs = points.map((p) => p.avgHighPrice ?? null);
  const lows = points.map((p) => p.avgLowPrice ?? null);
  const displayHighs = bridgeGaps(highs);
  const displayLows = bridgeGaps(lows);
  const buyVols = points.map((p) => p.highPriceVolume ?? 0);
  const sellVols = points.map((p) => p.lowPriceVolume ?? 0);
  const vols = buyVols.map((b, i) => b + sellVols[i]!);

  const prices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (showHigh && highs[i] != null) prices.push(highs[i]!);
    if (showLow && lows[i] != null) prices.push(lows[i]!);
    if (!showHigh && !showLow && (highs[i] ?? lows[i]) != null) prices.push((highs[i] ?? lows[i])!);
  }
  if (showHigh || showLow) {
    if (rangeHigh != null) prices.push(rangeHigh);
    if (rangeLow != null) prices.push(rangeLow);
    if (rangeAvg != null) prices.push(rangeAvg);
  }

  const plotLeft = PAD.left;
  const plotRight = W - (showVol ? 52 : PAD.right);
  const plotTop = PAD.top;
  const plotBottom = H - PAD.bottom;
  // Volume bars sit on a secondary axis along the bottom ~30% of the plot.
  const volHeight = showVol ? Math.round((plotBottom - plotTop) * 0.3) : 0;
  const priceBottom = plotBottom - volHeight - (showVol ? 10 : 0);
  const priceTop = plotTop;

  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 1;
  const { ticks, niceMin, niceMax } = niceTicks(minP, maxP, 5);
  const priceSpan = niceMax - niceMin || 1;
  const maxVol = Math.max(...vols, 1);
  const n = points.length;
  const xAt = (i: number) => plotLeft + (n <= 1 ? 0 : (i / (n - 1)) * (plotRight - plotLeft));
  const yAt = (v: number) => priceBottom - ((v - niceMin) / priceSpan) * (priceBottom - priceTop);
  const volY = (v: number) => plotBottom - (v / maxVol) * volHeight;

  const highCoords: (Coord | null)[] = displayHighs.map((v, i) => (v == null ? null : { x: xAt(i), y: yAt(v) }));
  const lowCoords: (Coord | null)[] = displayLows.map((v, i) => (v == null ? null : { x: xAt(i), y: yAt(v) }));

  const xTickCount = range === '1d' ? 6 : range === '1w' ? 7 : 6;
  const xTickStep = Math.max(1, Math.floor((n - 1) / (xTickCount - 1)));
  const xTicks: number[] = [];
  for (let i = 0; i < n; i += xTickStep) xTicks.push(i);
  if (xTicks[xTicks.length - 1] !== n - 1) xTicks.push(n - 1);

  const grid = ticks.map((t) => {
    const y = yAt(t);
    return `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="${border}" stroke-opacity="0.5" />
      <text class="chart-axis" x="${plotLeft - 8}" y="${y + 3}" text-anchor="end" fill="${muted}" font-size="11">${fmtGpShort(t)}</text>`;
  }).join('');

  const xLabels = xTicks.map((i) => {
    const x = xAt(i);
    return `<text class="chart-axis" x="${x}" y="${H - 10}" text-anchor="middle" fill="${muted}" font-size="11">${formatX(points[i]!.timestamp, range)}</text>`;
  }).join('');

  const guideEls = (showHigh || showLow)
    ? rangeGuides(rangeHigh, rangeAvg, rangeLow, yAt, plotLeft, plotRight, plotRight + 6, muted, up, down, gold)
    : '';

  const highSegs = showHigh ? coordSegments(highCoords) : [];
  const lowSegs = showLow ? coordSegments(lowCoords) : [];
  const bands = showHigh && showLow ? bandPolygons(highCoords, lowCoords) : [];

  const highParts = showHigh ? segmentMarkup(highSegs, up, 'chart-high', priceBottom, 'chartAreaUp') : { lines: '', areas: '', dots: '' };
  const lowParts = showLow ? segmentMarkup(lowSegs, down, 'chart-low', priceBottom, 'chartAreaDown') : { lines: '', areas: '', dots: '' };
  const bandEls = bands.map((p) => `<polygon points="${p}" fill="${gold}" fill-opacity="0.14" />`).join('');

  const lastHigh = showHigh ? lastCoord(highCoords) : null;
  const lastLow = showLow ? lastCoord(lowCoords) : null;
  const endpointDots = [
    lastHigh ? `<circle cx="${lastHigh.x.toFixed(1)}" cy="${lastHigh.y.toFixed(1)}" r="4.5" fill="${up}" stroke="${border}" stroke-width="1.5" />` : '',
    lastLow ? `<circle cx="${lastLow.x.toFixed(1)}" cy="${lastLow.y.toFixed(1)}" r="4.5" fill="${down}" stroke="${border}" stroke-width="1.5" />` : ''
  ].join('');

  let smoothLines = '';
  if (showSmooth) {
    const src = showHigh ? displayHighs : displayLows;
    const ma = movingAverage(src, 7);
    const smoothCoords: (Coord | null)[] = ma.map((v, i) => (v == null ? null : { x: xAt(i), y: yAt(v) }));
    smoothLines = coordSegments(smoothCoords)
      .map((s) => {
        const path = linePath(s);
        return path
          ? `<path d="${path}" fill="none" stroke="${gold}" stroke-width="1.5" stroke-dasharray="4 3" stroke-opacity="0.9" ${STROKE} />`
          : '';
      })
      .join('');
  }

  const barW = n > 1 ? Math.max(2, ((plotRight - plotLeft) / (n - 1)) * 0.75) : 6;
  const volBars = showVol
    ? buyVols.map((buy, i) => {
      const sell = sellVols[i]!;
      const total = buy + sell;
      if (!total) return '';
      const x = xAt(i) - barW / 2;
      const sellH = (sell / maxVol) * volHeight;
      const buyH = (buy / maxVol) * volHeight;
      const sellY = plotBottom - sellH;
      const buyY = sellY - buyH;
      let bars = '';
      if (sell > 0) {
        bars += `<rect class="chart-vol-sell" x="${x.toFixed(1)}" y="${sellY.toFixed(1)}" width="${barW.toFixed(1)}" height="${sellH.toFixed(1)}" fill="${down}" fill-opacity="0.75" />`;
      }
      if (buy > 0) {
        bars += `<rect class="chart-vol-buy" x="${x.toFixed(1)}" y="${buyY.toFixed(1)}" width="${barW.toFixed(1)}" height="${buyH.toFixed(1)}" fill="${up}" fill-opacity="0.75" />`;
      }
      return bars;
    }).join('')
    : '';

  // Connect the top of every bucket's total volume so zero buckets read as
  // points on the baseline rather than gaps between bars.
  const volTops: Coord[] = vols.map((v, i) => ({ x: xAt(i), y: volY(v) }));
  const volLine = showVol && volTops.length > 1
    ? `<path class="chart-vol-line" d="${linePath(volTops)}" fill="none" stroke="${muted}" stroke-width="1" stroke-opacity="0.55" ${STROKE} vector-effect="non-scaling-stroke" />`
    : '';
  const volZeroDots = showVol
    ? vols.map((v, i) => (v === 0
      ? `<circle class="chart-vol-zero" cx="${xAt(i).toFixed(1)}" cy="${plotBottom.toFixed(1)}" r="2" fill="${muted}" fill-opacity="0.8" />`
      : '')).join('')
    : '';

  const volAxisTicks = showVol ? [0, maxVol / 2, maxVol] : [];
  const volAxis = showVol
    ? volAxisTicks.map((t) => {
      const y = volY(t);
      return `<text class="chart-axis" x="${plotRight + 6}" y="${(y + 3).toFixed(1)}" text-anchor="start" fill="${muted}" font-size="10">${fmtGpShort(t)}</text>`;
    }).join('')
    : '';

  const xGrid = xTicks.map((i) => {
    const x = xAt(i);
    return `<line x1="${x}" y1="${priceTop}" x2="${x}" y2="${priceBottom}" stroke="${border}" stroke-opacity="0.18" />`;
  }).join('');

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
      <defs>
        <linearGradient id="chartAreaUp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${up}" stop-opacity="0.22" />
          <stop offset="100%" stop-color="${up}" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="chartAreaDown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${down}" stop-opacity="0.18" />
          <stop offset="100%" stop-color="${down}" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="chartBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${border}" stop-opacity="0.08" />
          <stop offset="100%" stop-color="${border}" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect x="${plotLeft}" y="${priceTop}" width="${plotRight - plotLeft}" height="${priceBottom - priceTop}" fill="url(#chartBg)" />
      ${grid}
      ${xGrid}
      ${guideEls}
      ${bandEls}
      ${highParts.areas}
      ${lowParts.areas}
      ${volBars}
      ${volLine}
      ${volZeroDots}
      ${highParts.lines}
      ${lowParts.lines}
      ${highParts.dots}
      ${lowParts.dots}
      ${smoothLines}
      ${endpointDots}
      <line x1="${plotLeft}" y1="${priceBottom}" x2="${plotRight}" y2="${priceBottom}" stroke="${border}" />
      ${showVol ? `<line x1="${plotLeft}" y1="${plotBottom - volHeight}" x2="${plotRight}" y2="${plotBottom - volHeight}" stroke="${border}" stroke-opacity="0.35" />` : ''}
      ${xLabels}
      ${volAxis}
      <line class="chart-crosshair" x1="0" y1="${priceTop}" x2="0" y2="${plotBottom}" stroke="${text}" stroke-opacity="0.5" visibility="hidden" />
    </svg>
    <div class="chart-tooltip" hidden></div>`;

  const svg = el.querySelector('svg')!;
  const hair = el.querySelector<SVGLineElement>('.chart-crosshair')!;
  const tip = el.querySelector<HTMLDivElement>('.chart-tooltip')!;

  // Map mouse X through the SVG's current transform so letterboxing doesn't throw the crosshair off.
  function svgX(clientX: number): number {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = 0;
    const ctm = svg.getScreenCTM();
    if (ctm) return pt.matrixTransform(ctm.inverse()).x;
    const rect = svg.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }

  // Pointer events so a finger can scrub the tooltip the same as a mouse.
  function showAt(clientX: number): void {
    const locX = svgX(clientX);
    let i = 0;
    let bestDist = Infinity;
    for (let idx = 0; idx < n; idx++) {
      const d = Math.abs(xAt(idx) - locX);
      if (d < bestDist) {
        bestDist = d;
        i = idx;
      }
    }
    const x = xAt(i);
    hair.setAttribute('x1', String(x));
    hair.setAttribute('x2', String(x));
    hair.setAttribute('visibility', 'visible');
    const p = points[i]!;
    const high = highs[i];
    const low = lows[i];
    const buy = buyVols[i]!;
    const sell = sellVols[i]!;
    const vol = vols[i]!;
    tip.hidden = false;
    tip.innerHTML = `
      <strong>${fmtTime(p.timestamp)}</strong>
      <div>Insta-buy: ${fmtGp(high)}</div>
      <div>Insta-sell: ${fmtGp(low)}</div>
      <div>Buy vol: ${buy.toLocaleString('en-US')}</div>
      <div>Sell vol: ${sell.toLocaleString('en-US')}</div>
      <div>Total vol: ${vol.toLocaleString('en-US')}</div>`;
    const rect = el.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const px = ((x / W) * svgRect.width);
    tip.style.left = `${Math.min(px + 12, rect.width - 160)}px`;
    tip.style.top = '12px';
  }

  function hideTip(): void {
    hair.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  }

  svg.onpointermove = (ev) => showAt(ev.clientX);
  svg.onpointerleave = hideTip;
}
