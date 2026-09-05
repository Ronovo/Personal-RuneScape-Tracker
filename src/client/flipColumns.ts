// The Flip Helper's result columns, declared once.
//
// Each column used to be spelled out in six places - the ColumnKey union, the
// ALL_COLUMN_KEYS array, a <th> in flip.html, a checkbox <label> in flip.html,
// an <option> in the mobile sort <select>, and a <td> template in flip.ts -
// with the mobile card carrying a seventh, subtly different, list. The tooltips
// had already drifted apart between the <th> and the checkbox that describe the
// same number. Everything below is now generated from this one table, so a new
// column is one entry here and nothing else.

import { fmt, fmtGp, fmtGpShort, fmtPct, fmtAgo, pctClass, escapeHtml } from './format.js';
import type { FlipItem } from './types.js';

export type ColumnKey =
  | 'buy' | 'sell' | 'margin' | 'tax' | 'profit' | 'roi' | 'limit' | 'profitPerLimit'
  | 'gpPerHour' | 'capital' | 'volume' | 'age' | 'marginVsAvg' | 'score' | 'confidence'
  | 'realisticProfit';

/** What a cell can depend on beyond the row itself. */
export interface CellContext {
  bankrollOn: boolean;
}

export interface FlipColumn {
  key: ColumnKey;
  /** Canonical name: the sort dropdown and, unless panelLabel says otherwise, the columns panel. */
  label: string;
  /** Compact form for the table header and the mobile card, where width is tight. */
  shortLabel?: string;
  /** Longer form for the columns panel, which has room to be explicit. */
  panelLabel?: string;
  /** Shared by the header cell and the checkbox - one description per column, not two. */
  title: string;
  /** Checked in FACTORY_DEFAULT_COLUMNS. */
  factoryDefault?: boolean;
  /** Rendered in the mobile card as well as the table. */
  onCard?: boolean;
  /** Class applied to the table cell (ROI colours by sign). */
  cellClass?: (item: FlipItem) => string;
  /**
   * The cell's inner HTML. Returns markup, not text, so anything derived from
   * item data must be escaped here - see `confidence`. Every other formatter
   * emits digits and fixed punctuation.
   */
  format: (item: FlipItem, ctx: CellContext) => string;
}

const gpOrNa = (value: number | null | undefined): string => fmtGp(value);

/**
 * The confidence dot. Exported because the mobile card shows it in its header
 * rather than as a field, and both spellings drifting apart is exactly what
 * this module exists to prevent. The only value here derived from item text,
 * so the only one that has to escape.
 */
export function confidenceDotHtml(item: FlipItem): string {
  return `<span class="conf-dot conf-${item.confidence}" title="${escapeHtml(item.confidenceWhy || item.confidence)}"></span>`;
}

export const COLUMNS: FlipColumn[] = [
  {
    key: 'buy',
    label: 'Buy',
    title: 'Price to buy at - the insta-sell (low) price.',
    factoryDefault: true,
    onCard: true,
    format: (item) => gpOrNa(item.buy),
  },
  {
    key: 'sell',
    label: 'Sell',
    title: 'Price to sell at - the insta-buy (high) price.',
    factoryDefault: true,
    onCard: true,
    format: (item) => gpOrNa(item.sell),
  },
  {
    key: 'margin',
    label: 'Margin',
    title: 'Sell minus Buy, before GE tax.',
    factoryDefault: true,
    onCard: true,
    format: (item) => gpOrNa(item.margin),
  },
  {
    key: 'tax',
    label: 'Tax',
    title: 'GE tax on the sale: 2% of the sell price, floored, capped at 5,000,000 gp. Some items are tax-exempt.',
    format: (item) => gpOrNa(item.tax),
  },
  {
    key: 'profit',
    label: 'Profit',
    title: 'Margin minus GE tax - profit per single item flipped.',
    factoryDefault: true,
    format: (item) => gpOrNa(item.profit),
  },
  {
    key: 'roi',
    label: 'ROI%',
    title: 'Profit as a percentage of the buy price.',
    factoryDefault: true,
    onCard: true,
    cellClass: (item) => `pct ${pctClass(item.roi)}`,
    format: (item) => fmtPct(item.roi),
  },
  {
    key: 'limit',
    label: 'Limit',
    title: 'GE buy limit: the most you can buy of this item per 4-hour window.',
    format: (item) => (item.limit ? fmt(item.limit) : 'n/a'),
  },
  {
    key: 'profitPerLimit',
    label: 'Profit/limit',
    title: 'Profit if you buy and sell up to the buy limit (Profit x Limit).',
    onCard: true,
    format: (item) => gpOrNa(item.profitPerLimit),
  },
  {
    key: 'gpPerHour',
    label: 'GP/hr',
    title: 'Realistic profit per hour: profit after tax scaled by how fast the buy limit could actually fill (limited by 24h volume).',
    onCard: true,
    format: (item) => (item.gpPerHour != null ? `~${fmtGpShort(item.gpPerHour)}` : 'n/a'),
  },
  {
    key: 'capital',
    label: 'Capital',
    title: 'gp needed to buy up to the buy limit (Buy x Limit).',
    onCard: true,
    format: (item) => gpOrNa(item.capital),
  },
  {
    key: 'volume',
    label: 'Volume',
    shortLabel: 'Vol/day',
    title: 'Total traded volume (buy + sell) over the last 24 hours.',
    factoryDefault: true,
    onCard: true,
    format: (item) => fmt(item.volume24h),
  },
  {
    key: 'age',
    label: 'Age',
    title: 'Time since the last recorded trade at this price.',
    onCard: true,
    format: (item) => (item.age != null ? fmtAgo(item.age) : 'n/a'),
  },
  {
    key: 'marginVsAvg',
    label: 'Margin vs avg',
    shortLabel: '×avg',
    title: "Current margin divided by this item's own average 24h margin. Above 1 means the spread is wider than usual right now.",
    onCard: true,
    format: (item) => (item.marginVsAvg != null ? `${item.marginVsAvg.toFixed(2)}×` : 'n/a'),
  },
  {
    key: 'score',
    label: 'Score',
    title: 'Composite 0-100 opportunity score: ROI, profit throughput, volume, freshness and confidence combined.',
    onCard: true,
    format: (item) => fmt(item.score),
  },
  {
    key: 'confidence',
    label: 'Confidence',
    title: 'High/medium/low, based on volume, how fresh the price is, and margin vs. the 24h average. Hover a row\'s dot for the specific reason.',
    format: confidenceDotHtml,
  },
  {
    key: 'realisticProfit',
    label: 'Realistic',
    panelLabel: 'Realistic Profit (bankroll) ⓘ',
    title: "Profit if you spend your bankroll on this item: buys as many units as you can afford, capped by the item's buy limit, then multiplies by profit per unit. Only calculated once a bankroll is set above.",
    onCard: true,
    format: (item, ctx) =>
      ctx.bankrollOn && item.realisticProfit != null ? fmtGpShort(item.realisticProfit) : 'n/a',
  },
];

export const ALL_COLUMN_KEYS: ColumnKey[] = COLUMNS.map((c) => c.key);

export const FACTORY_DEFAULT_COLUMNS: ColumnKey[] = COLUMNS.filter((c) => c.factoryDefault).map((c) => c.key);

function headerLabel(column: FlipColumn): string {
  return column.shortLabel ?? column.label;
}

/**
 * Which columns to emit. Hidden columns are left out of the markup rather than
 * rendered and hidden with [hidden] - at fifty rows that was two thirds of the
 * cells built for nothing. The caller re-renders when the selection changes.
 */
export type ColumnFilter = (key: ColumnKey) => boolean;

const ALL_VISIBLE: ColumnFilter = () => true;

function shown(visible: ColumnFilter): FlipColumn[] {
  return COLUMNS.filter((c) => visible(c.key));
}

/** Header cells, appended after the fixed actions/Item columns already in the markup. */
export function columnHeadersHtml(visible: ColumnFilter = ALL_VISIBLE): string {
  return shown(visible).map((c) =>
    `<th data-col="${c.key}" data-sort="${c.key}" title="${escapeHtml(c.title)}">${escapeHtml(headerLabel(c))}</th>`
  ).join('');
}

export function columnCellsHtml(item: FlipItem, ctx: CellContext, visible: ColumnFilter = ALL_VISIBLE): string {
  return shown(visible).map((c) => {
    const cls = c.cellClass ? ` class="${c.cellClass(item)}"` : '';
    return `<td data-col="${c.key}"${cls}>${c.format(item, ctx)}</td>`;
  }).join('');
}

/** Columns currently in the table, for the empty-state row's colspan. */
export function visibleColumnCount(visible: ColumnFilter = ALL_VISIBLE): number {
  return shown(visible).length;
}

/** The mobile card's definition list - the same formatters, a curated subset. */
export function cardCellsHtml(item: FlipItem, ctx: CellContext): string {
  return COLUMNS.filter((c) => c.onCard)
    // Realistic Profit is meaningless without a bankroll, and the card has no
    // column toggles of its own to hide it with.
    .filter((c) => c.key !== 'realisticProfit' || ctx.bankrollOn)
    .map((c) => `<div><dt>${escapeHtml(headerLabel(c))}</dt><dd>${c.format(item, ctx)}</dd></div>`)
    .join('');
}

/** Checkbox rows, inserted above the panel's own action buttons. */
export function columnsPanelHtml(): string {
  return COLUMNS.map((c) =>
    `<label title="${escapeHtml(c.title)}"><input type="checkbox" data-col="${c.key}" /> ${escapeHtml(c.panelLabel ?? c.label)}</label>`
  ).join('');
}

/** Sort options, appended after the fixed "Item (A-Z)" entry already in the markup. */
export function sortOptionsHtml(): string {
  return COLUMNS.map((c) => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join('');
}
