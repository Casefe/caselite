import { describe, expect, it } from 'vitest';
import type { AppearanceValues } from '../../contracts/src/appearance';
import { createAppearanceApplication } from './appearance-application';
function create() {
  let current: AppearanceValues = { theme: 'light' };
  let writes = 0,
    unknown = false;
  const app = createAppearanceApplication({
    read: () => current.theme,
    readAppearance: () => ({ ...current }),
    write: (theme) => {
      writes++;
      current = { ...current, theme };
      if (unknown) throw Error('receipt unknown');
    },
    writeSkin: (skin) => {
      writes++;
      current = skin ? { ...current, skin } : { theme: current.theme };
      if (unknown) throw Error('receipt unknown');
    },
  });
  return {
    app,
    get: () => ({ ...current }),
    writes: () => writes,
    fail: () => {
      unknown = true;
    },
  };
}
describe('appearance skin command ownership', () => {
  it('requires complete application confirmation and preserves style through AI change and undo', () => {
    const { app, get } = create();
    expect(app.execute({ protocol_version: 1, operation: 'set_skin', skin: 'pine' })).toEqual({
      ok: true,
      theme: 'light',
      skin: 'pine',
    });
    expect(app.execute({ protocol_version: 1, operation: 'applied', theme: 'light' }).ok).toBe(
      false,
    );
    expect(
      app.execute({ protocol_version: 1, operation: 'applied', theme: 'light', skin: 'lilac' }).ok,
    ).toBe(false);
    expect(
      app.execute({ protocol_version: 1, operation: 'applied', theme: 'light', skin: 'pine' }).ok,
    ).toBe(true);
    const cmd = app.prepare('window', 'dark')!;
    expect(app.propose(cmd.id, 'window', { theme: 'dark' }).state).toBe('saved');
    expect(get()).toEqual({ theme: 'dark', skin: 'pine' });
    expect(app.undo(cmd.id, 'window').ok).toBe(true);
    expect(get()).toEqual({ theme: 'light', skin: 'pine' });
  });
  it('invalidates prepared AI commands and undo after skin changes, including reset', () => {
    const { app, get } = create(),
      cmd = app.prepare('window', 'dark')!;
    app.execute({ protocol_version: 1, operation: 'set_skin', skin: 'paper' });
    expect(app.propose(cmd.id, 'window', { theme: 'dark' }).state).toBe('rejected');
    const later = app.prepare('window', 'dark')!;
    app.propose(later.id, 'window', { theme: 'dark' });
    app.execute({ protocol_version: 1, operation: 'reset_skin' });
    expect(app.undo(later.id, 'window').ok).toBe(false);
    expect(get()).toEqual({ theme: 'dark' });
  });
  it('reports unknown skin receipts and re-reads without replaying a write', () => {
    const { app, get, writes, fail } = create();
    fail();
    expect(app.execute({ protocol_version: 1, operation: 'set_skin', skin: 'lilac' }).ok).toBe(
      false,
    );
    expect(get()).toEqual({ theme: 'light', skin: 'lilac' });
    expect(writes()).toBe(1);
    expect(app.execute({ protocol_version: 1, operation: 'read' })).toEqual({
      ok: true,
      theme: 'light',
      skin: 'lilac',
    });
    expect(writes()).toBe(1);
  });
  it('does not pretend a theme-only adapter can save a new skin', () => {
    const app = createAppearanceApplication({
      read: () => 'light',
      write: () => {
        throw Error('must not write');
      },
    });
    expect(app.execute({ protocol_version: 1, operation: 'set_skin', skin: 'pine' }).ok).toBe(
      false,
    );
    expect(app.execute({ protocol_version: 1, operation: 'reset_skin' }).ok).toBe(false);
  });
});
