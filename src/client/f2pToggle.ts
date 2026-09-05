// The F2P quick toggle shared by the Grand Exchange and Flip Helper toolbars.
//
// Both pages already have a Members select (all / members / f2p) inside the
// filter drawer. The toolbar button is a shortcut onto that same select: it
// flips to F2P, and flipping back restores whatever was selected before rather
// than always snapping to "All".

import type { MembersFilter } from './types.js';

// Pure core, kept separate from the DOM wiring so it can be unit-tested.
// `remembered` is what the select held before F2P was switched on; the guard
// stops a stale 'f2p' (e.g. the page loaded already filtered) from making the
// button a no-op.
export function toggledMembersFilter(current: MembersFilter, remembered: MembersFilter): MembersFilter {
  if (current !== 'f2p') return 'f2p';
  return remembered === 'f2p' ? 'all' : remembered;
}

export interface F2pToggle {
  isF2p(): boolean;
  sync(): void;
}

// Wires the button to the select. onChange fires only when the button itself
// changed the filter - editing the select directly just re-syncs the button,
// matching the drawer's "nothing reloads until you hit Scan/Refresh" rule.
export function mountF2pToggle({ button, select, onChange }: {
  button: HTMLButtonElement;
  select: HTMLSelectElement;
  onChange: () => void;
}): F2pToggle {
  let remembered = select.value === 'f2p' ? 'all' : (select.value as MembersFilter);

  const isF2p = (): boolean => select.value === 'f2p';

  const sync = (): void => {
    const on = isF2p();
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  };

  button.addEventListener('click', () => {
    const current = select.value as MembersFilter;
    if (current !== 'f2p') remembered = current;
    select.value = toggledMembersFilter(current, remembered);
    sync();
    onChange();
  });

  select.addEventListener('change', () => {
    if (select.value !== 'f2p') remembered = select.value as MembersFilter;
    sync();
  });

  sync();
  return { isF2p, sync };
}
