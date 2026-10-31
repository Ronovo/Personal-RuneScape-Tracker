/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountF2pToggle, toggledMembersFilter } from './f2pToggle.js';

test('turning the toggle on always selects f2p', () => {
  assert.equal(toggledMembersFilter('all', 'all'), 'f2p');
  assert.equal(toggledMembersFilter('members', 'members'), 'f2p');
});

test('turning it off restores what was selected before', () => {
  assert.equal(toggledMembersFilter('f2p', 'all'), 'all');
  assert.equal(toggledMembersFilter('f2p', 'members'), 'members');
});

test("a remembered 'f2p' falls back to all so the button is never a no-op", () => {
  assert.equal(toggledMembersFilter('f2p', 'f2p'), 'all');
});

function control<T extends object>(props: T): T & { fire(type: string): void } {
  const handlers = new Map<string, () => void>();
  return Object.assign(props, {
    addEventListener: (type: string, handler: () => void) => { handlers.set(type, handler); },
    fire: (type: string) => handlers.get(type)!(),
  });
}

test('a page that opens already on f2p shows the button on, and one click turns it off', () => {
  const pressed: string[] = [];
  const button = control({ classList: { toggle() {} }, setAttribute: (_name: string, value: string) => { pressed.push(value); } });
  const select = control({ value: 'f2p' });
  let changes = 0;
  const toggle = mountF2pToggle({
    button: button as unknown as HTMLButtonElement,
    select: select as unknown as HTMLSelectElement,
    onChange: () => { changes++; },
  });
  assert.deepEqual(pressed, ['true']);
  assert.equal(toggle.isF2p(), true);

  button.fire('click');
  assert.equal(select.value, 'all');
  assert.deepEqual(pressed, ['true', 'false']);
  assert.equal(changes, 1);

  select.value = 'members';
  select.fire('change');
  button.fire('click');
  button.fire('click');
  assert.equal(select.value, 'members');
  assert.equal(changes, 3);
});
