/// <reference types="node" />
// filterRow.ts is the only pure module here that touches the DOM, so it gets
// the smallest stub that makes its three behaviours observable: reading
// controls, writing them back, and persisting. No jsdom - the surface used is
// getElementById, .value/.checked, .options, and localStorage.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class FakeSelect {
  value = '';
  options: { value: string }[] = [];
}
class FakeInput {
  value = '';
  checked = false;
}

const elements = new Map<string, FakeInput | FakeSelect>();
const store = new Map<string, string>();

// `el instanceof HTMLSelectElement` is how the module decides whether to
// validate against the option list, so the stub has to satisfy that check.
Object.assign(globalThis, {
  HTMLSelectElement: FakeSelect,
  document: { getElementById: (id: string) => elements.get(id) ?? null },
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { createFilterRow, flipSortDir, sortDirLabel } = await import('./filterRow.js');

interface Row extends Record<string, string | boolean> {
  minPrice: string;
  maxPrice: string;
  membersOnly: string;
  hideStale: boolean;
}

const DEFAULTS: Row = { minPrice: '50', maxPrice: '', membersOnly: 'all', hideStale: false };

function build() {
  elements.clear();
  store.clear();
  const minPrice = new FakeInput();
  const maxPrice = new FakeInput();
  const hideStale = new FakeInput();
  const members = new FakeSelect();
  members.options = [{ value: 'all' }, { value: 'members' }, { value: 'f2p' }];
  elements.set('minPrice', minPrice);
  elements.set('maxPrice', maxPrice);
  elements.set('hideStale', hideStale);
  elements.set('membersSelect', members);

  const row = createFilterRow<Row>('test_filters', [
    { id: 'minPrice' },
    { id: 'maxPrice', blankable: true },
    { id: 'hideStale', kind: 'checked' },
    { id: 'membersSelect', key: 'membersOnly' },
  ], DEFAULTS);

  return { row, minPrice, maxPrice, hideStale, members };
}

beforeEach(() => { elements.clear(); store.clear(); });

test('read() keys values by their stored name, not the element id', () => {
  const { row, minPrice, members } = build();
  minPrice.value = '900';
  members.value = 'f2p';
  assert.deepEqual(row.read(), { minPrice: '900', maxPrice: '', hideStale: false, membersOnly: 'f2p' });
});

test('apply() writes values through, and checkboxes take booleans', () => {
  const { row, minPrice, hideStale, members } = build();
  row.apply({ minPrice: '1234', hideStale: true, membersOnly: 'members' });
  assert.equal(minPrice.value, '1234');
  assert.equal(hideStale.checked, true);
  assert.equal(members.value, 'members');
});

test('a field absent from the incoming values falls back to its default', () => {
  const { row, minPrice, members } = build();
  minPrice.value = '999';
  members.value = 'f2p';
  row.apply({});
  assert.equal(minPrice.value, '50');
  assert.equal(members.value, 'all');
});

// The distinction `blankable` exists for: clearing Max price means "no cap",
// and must not be read as "unset, so use the default".
test('blank is kept on a blankable field and replaced on a normal one', () => {
  const { row, minPrice, maxPrice } = build();
  maxPrice.value = '5000';
  minPrice.value = '900';
  row.apply({ maxPrice: '', minPrice: '' });
  assert.equal(maxPrice.value, '', 'no cap stays no cap');
  assert.equal(minPrice.value, '50', 'a non-blankable field takes the default');
});

// This is the bug the shared module fixed: only the GE page used to check.
test('a stored select value that is no longer an option falls back', () => {
  const { row, members } = build();
  row.apply({ membersOnly: 'retired-option' });
  assert.equal(members.value, 'all');

  row.apply({ membersOnly: 'f2p' });
  assert.equal(members.value, 'f2p', 'a value that is still an option is kept');
});

test('persist() saves the controls plus any page state handed to it', () => {
  const { row, minPrice, hideStale } = build();
  minPrice.value = '250';
  hideStale.checked = true;
  row.persist({ sortDir: 'asc', view: 'volume' });

  assert.deepEqual(row.saved<{ sortDir: string; view: string }>(), {
    minPrice: '250', maxPrice: '', hideStale: true, membersOnly: '',
    sortDir: 'asc', view: 'volume',
  });
});

test('saved() is empty before anything is stored, and empty again after clear()', () => {
  const { row, minPrice } = build();
  assert.deepEqual(row.saved(), {});
  minPrice.value = '77';
  row.persist();
  assert.equal(row.saved().minPrice, '77');
  row.clear();
  assert.deepEqual(row.saved(), {});
});

// A page can be missing a control another page has; the shared module must not
// assume its whole field list is present.
test('a field whose element is absent is skipped rather than throwing', () => {
  const { row } = build();
  elements.delete('maxPrice');
  assert.doesNotThrow(() => row.apply({ maxPrice: '10' }));
  assert.ok(!('maxPrice' in row.read()));
});

test('sortDirLabel and flipSortDir agree on which way is which', () => {
  assert.equal(sortDirLabel('desc'), '↓ High to low');
  assert.equal(sortDirLabel('asc'), '↑ Low to high');
  assert.equal(flipSortDir('desc'), 'asc');
  assert.equal(flipSortDir('asc'), 'desc');
});
