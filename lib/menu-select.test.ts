import { describe, expect, it } from 'vitest';
import { chooseMenu } from './menu-select';

const breakfast = { id: 'm-1', name: 'Breakfast' };
const dinner = { id: 'm-2', name: 'Dinner' };

describe('chooseMenu', () => {
  it('opens the menu that was asked for', () => {
    expect(chooseMenu([breakfast, dinner], 'm-2')?.name).toBe('Dinner');
  });

  it('falls back to the first menu rather than failing on an unknown id', () => {
    // The id comes from the URL. A stale link, a menu unpublished since it was
    // shared, or another restaurant's menu must all show the live menu instead
    // of an error page.
    expect(chooseMenu([breakfast, dinner], 'm-9')?.name).toBe('Breakfast');
    expect(chooseMenu([breakfast, dinner], '')?.name).toBe('Breakfast');
    expect(chooseMenu([breakfast, dinner], null)?.name).toBe('Breakfast');
    expect(chooseMenu([breakfast, dinner], '   ')?.name).toBe('Breakfast');
  });

  it('returns nothing when the restaurant has no menus at all', () => {
    expect(chooseMenu([], 'm-1')).toBeNull();
  });

  it('keeps the caller\'s order, so the first menu is the restaurant\'s first', () => {
    // Ordering is the caller's job: the guest read sorts by sort_order, the
    // editor sorts drafts in too. This function must not re-sort behind them.
    expect(chooseMenu([dinner, breakfast])?.name).toBe('Dinner');
  });
});
