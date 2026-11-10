import { describe, expect, it } from 'vitest';
import { readInitialAppearance } from './appearance-initial';
describe('initial appearance boundary', () => {
  it('keeps only validated snapshots and never invents success for malformed or unavailable Main', () => {
    expect(readInitialAppearance(() => ({ ok: true, theme: 'dark' }))).toEqual({
      ok: true,
      theme: 'dark',
    });
    for (const value of [
      undefined,
      { ok: true, theme: 'other' },
      { ok: true, theme: 'light', path: '/private' },
    ])
      expect(readInitialAppearance(() => value)).toMatchObject({ ok: false });
    expect(
      readInitialAppearance(() => {
        throw new Error('unavailable');
      }),
    ).toMatchObject({ ok: false });
  });
});
