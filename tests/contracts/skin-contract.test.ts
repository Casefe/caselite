import { describe, expect, it } from 'vitest';
import {
  appearanceRequestSchema,
  appearanceResponseSchema,
} from '../../packages/contracts/src/appearance';

describe('four skin protocol', () => {
  it('keeps legacy requests and accepts exactly the approved styles', () => {
    expect(
      appearanceRequestSchema.safeParse({ protocol_version: 1, operation: 'set', theme: 'dark' })
        .success,
    ).toBe(true);
    for (const skin of ['deep-sea', 'lilac', 'paper', 'pine']) {
      expect(
        appearanceRequestSchema.safeParse({ protocol_version: 1, operation: 'set_skin', skin })
          .success,
      ).toBe(true);
      expect(appearanceResponseSchema.safeParse({ ok: true, theme: 'dark', skin }).success).toBe(
        true,
      );
    }
    for (const skin of ['classic', 'clio', 'alpha', 'casefleet', '', null])
      expect(
        appearanceRequestSchema.safeParse({ protocol_version: 1, operation: 'set_skin', skin })
          .success,
      ).toBe(false);
    expect(
      appearanceRequestSchema.safeParse({
        protocol_version: 1,
        operation: 'set_skin',
        skin: 'pine',
        path: '/arbitrary',
      }).success,
    ).toBe(false);
    expect(
      appearanceRequestSchema.safeParse({
        protocol_version: 1,
        operation: 'reset_skin',
        skin: 'pine',
      }).success,
    ).toBe(false);
  });
});
