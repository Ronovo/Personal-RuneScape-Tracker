// Hand-rolled SVG price chart. No library.
// Wiki points can have null prices, so polylines are split at gaps rather than
// interpolating (which made the old sparkline's x-axis lie).
(function () {
  const W = 800;
  const H = 280;
  const PAD = { top: 16, right: 16, bottom: 36, left: 64 };

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // Nice-number rounding so y-axis ticks land on 1/2/5 * 10^n instead of ugly floats.
  function niceNum(range, round) {
    const exp = Math.floor(Math.log10(range || 1));
    const frac = (range || 1) / 10 ** exp;
    let nice;
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

  function niceTicks(min, max, count = 5) {
    const range = niceNum(max - min || 1, false);
    const step = niceNum(range / (count - 1), true);
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(v);
    return { ticks, niceMin, niceMax };
  }

  // X labels depend on the selected range: time-of-day for 1D, dates otherwise.
  function formatX(ts, range) {
    const d = new Date(ts * 1000);
    if (range === '1d') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (range === '1y') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // 7-point moving average overlay for the Smooth toggle. Skips nulls in the window.
  function movingAverage(values, window = 7) {
    const half = Math.floor(window / 2);
    return values.map((_, i) => {
      let sum = 0;
      let n = 0;
      for (let j = i - half; j <= i + half; j++) {
        if (j >= 0 && j < values.length && values[j] != null) {
          sum += values[j];
          n++;
        }
      }
      return n ? sum / n : null;
    });
  }

  // Split a polyline wherever the wiki has a null price, instead of drawing a straight lie.
  function polylineSegments(coords) {
    const segs = [];
    let cur = [];
    for (const c of coords) {
      if (c == null) {
        if (cur.length >= 2) segs.push(cur);
        cur = [];
      } else {
        cur.push(c);
      }
    }
    if (cur.length >= 2) segs.push(cur);
    return segs;
  }

  // Fill band between high and low, also broken at gaps so it doesn't span missing data.
  function bandPolygons(highCoords, lowCoords) {
    const polys = [];
    let hi = [];
    let lo = [];
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
      if (highCoords[i] && lowCoords[i]) {
        hi.push(highCoords[i]);
        lo.push(lowCoords[i]);
      } else {
        flush();
      }
    }
    flush();
    return polys;
  }

  // series.high / .low / .volume / .smooth are checkbox flags from item.js.
  function render(el, { points = [], range = '1w', series = {} } = {}) {
    const showHigh = series.high !== false;
    const showLow = series.low !== false;
    const showVol = Boolean(series.volume);
    const showSmooth = Boolean(series.smooth);
    const { fmtGp, fmtGpShort, fmtTime } = window.OsrsFormat;

    const up = cssVar('--up', '#6fbf6f');
    const down = cssVar('--down', '#d97a6a');
    const muted = cssVar('--muted', '#a89a80');
    const gold = cssVar('--gold', '#d9c27e');
    const border = cssVar('--border', '#4a3f2f');
    const text = cssVar('--text', '#e8e0d0');

    if (!points.length) {
      el.innerHTML = '<p class="status">No price history for this range.</p>';
      el._chartState = null;
      return;
    }

    const highs = points.map((p) => p.avgHighPrice ?? null);
    const lows = points.map((p) => p.avgLowPrice ?? null);
    const vols = points.map((p) => (p.highPriceVolume ?? 0) + (p.lowPriceVolume ?? 0));
    const prices = [];
    for (let i = 0; i < points.length; i++) {
      if (showHigh && highs[i] != null) prices.push(highs[i]);
      if (showLow && lows[i] != null) prices.push(lows[i]);
      if (!showHigh && !showLow && (highs[i] ?? lows[i]) != null) prices.push(highs[i] ?? lows[i]);
    }

    const plotLeft = PAD.left;
    const plotRight = W - PAD.right;
    const plotTop = PAD.top;
    const plotBottom = H - PAD.bottom;
    // Volume bars sit on a secondary axis along the bottom ~22% of the plot.
    const volHeight = showVol ? Math.round((plotBottom - plotTop) * 0.22) : 0;
    const priceBottom = plotBottom - volHeight - (showVol ? 8 : 0);
    const priceTop = plotTop;

    const minP = prices.length ? Math.min(...prices) : 0;
    const maxP = prices.length ? Math.max(...prices) : 1;
    const { ticks, niceMin, niceMax } = niceTicks(minP, maxP, 5);
    const priceSpan = niceMax - niceMin || 1;
    const maxVol = Math.max(...vols, 1);
    const n = points.length;
    const xAt = (i) => plotLeft + (n <= 1 ? 0 : (i / (n - 1)) * (plotRight - plotLeft));
    const yAt = (v) => priceBottom - ((v - niceMin) / priceSpan) * (priceBottom - priceTop);
    const volY = (v) => plotBottom - (v / maxVol) * volHeight;

    const highCoords = highs.map((v, i) => (v == null ? null : { x: xAt(i), y: yAt(v) }));
    const lowCoords = lows.map((v, i) => (v == null ? null : { x: xAt(i), y: yAt(v) }));

    const xTickCount = range === '1d' ? 6 : range === '1w' ? 7 : 6;
    const xTickStep = Math.max(1, Math.floor((n - 1) / (xTickCount - 1)));
    const xTicks = [];
    for (let i = 0; i < n; i += xTickStep) xTicks.push(i);
    if (xTicks[xTicks.length - 1] !== n - 1) xTicks.push(n - 1);

    const grid = ticks.map((t) => {
      const y = yAt(t);
      return `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" stroke="${border}" stroke-opacity="0.5" />
        <text class="chart-axis" x="${plotLeft - 8}" y="${y + 3}" text-anchor="end" fill="${muted}" font-size="11">${fmtGpShort(t)}</text>`;
    }).join('');

    const xLabels = xTicks.map((i) => {
      const x = xAt(i);
      return `<text class="chart-axis" x="${x}" y="${H - 10}" text-anchor="middle" fill="${muted}" font-size="11">${formatX(points[i].timestamp, range)}</text>`;
    }).join('');

    const highSegs = showHigh ? polylineSegments(highCoords.map((c) => c && `${c.x.toFixed(1)},${c.y.toFixed(1)}`)) : [];
    const lowSegs = showLow ? polylineSegments(lowCoords.map((c) => c && `${c.x.toFixed(1)},${c.y.toFixed(1)}`)) : [];
    const bands = showHigh && showLow ? bandPolygons(highCoords, lowCoords) : [];

    const highLines = highSegs.map((s) => `<polyline class="chart-high" points="${s.join(' ')}" fill="none" stroke="${up}" stroke-width="2" />`).join('');
    const lowLines = lowSegs.map((s) => `<polyline class="chart-low" points="${s.join(' ')}" fill="none" stroke="${down}" stroke-width="2" />`).join('');
    const bandEls = bands.map((p) => `<polygon points="${p}" fill="${gold}" fill-opacity="0.12" />`).join('');

    let smoothLines = '';
    if (showSmooth) {
      const src = showHigh ? highs : lows;
      const ma = movingAverage(src, 7);
      const coords = ma.map((v, i) => (v == null ? null : `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`));
      smoothLines = polylineSegments(coords)
        .map((s) => `<polyline points="${s.join(' ')}" fill="none" stroke="${gold}" stroke-width="1.5" stroke-dasharray="4 3" />`)
        .join('');
    }

    const barW = n > 1 ? Math.max(1, ((plotRight - plotLeft) / (n - 1)) * 0.7) : 4;
    const volBars = showVol
      ? vols.map((v, i) => {
        if (!v) return '';
        const h = plotBottom - volY(v);
        return `<rect class="chart-vol" x="${(xAt(i) - barW / 2).toFixed(1)}" y="${volY(v).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${muted}" fill-opacity="0.45" />`;
      }).join('')
      : '';

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
        ${grid}
        ${bandEls}
        ${volBars}
        ${highLines}
        ${lowLines}
        ${smoothLines}
        <line x1="${plotLeft}" y1="${priceBottom}" x2="${plotRight}" y2="${priceBottom}" stroke="${border}" />
        ${xLabels}
        <line class="chart-crosshair" x1="0" y1="${priceTop}" x2="0" y2="${plotBottom}" stroke="${text}" stroke-opacity="0.5" visibility="hidden" />
      </svg>
      <div class="chart-tooltip" hidden></div>`;

    const svg = el.querySelector('svg');
    const hair = el.querySelector('.chart-crosshair');
    const tip = el.querySelector('.chart-tooltip');

    el._chartState = { points, highs, lows, vols, xAt, plotLeft, plotRight, n, fmtGp, fmtTime };

    // Map mouse X through the SVG's current transform so letterboxing doesn't throw the crosshair off.
    function svgX(clientX) {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = 0;
      const ctm = svg.getScreenCTM();
      if (ctm) return pt.matrixTransform(ctm.inverse()).x;
      const rect = svg.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * W;
    }

    // Pointer events so a finger can scrub the tooltip the same as a mouse.
    function showAt(clientX) {
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
      hair.setAttribute('x1', x);
      hair.setAttribute('x2', x);
      hair.setAttribute('visibility', 'visible');
      const p = points[i];
      const high = highs[i];
      const low = lows[i];
      const vol = vols[i];
      tip.hidden = false;
      tip.innerHTML = `
        <strong>${fmtTime(p.timestamp)}</strong>
        <div>Insta-buy: ${fmtGp(high)}</div>
        <div>Insta-sell: ${fmtGp(low)}</div>
        <div>Volume: ${vol ? vol.toLocaleString('en-US') : 'n/a'}</div>`;
      const rect = el.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const px = ((x / W) * svgRect.width);
      tip.style.left = `${Math.min(px + 12, rect.width - 160)}px`;
      tip.style.top = '12px';
    }

    function hideTip() {
      hair.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    }

    svg.onpointermove = (ev) => showAt(ev.clientX);
    svg.onpointerleave = hideTip;
  }

  window.OsrsChart = { render };
})();
