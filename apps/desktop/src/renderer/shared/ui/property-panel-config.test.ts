import { expect, it } from 'vitest';
import { resolvePropertyPanel } from './property-panel-config';

const fields = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B', maxLength: 2 },
] as const;
it('applies default, page and subpage style in order', () => {
  expect(
    resolvePropertyPanel(
      fields,
      { fieldIds: ['a', 'b'], style: { gap: '8px', fontSize: '14px' } },
      { fieldIds: ['b'], style: { gap: '9px' } },
    ),
  ).toEqual({
    fields: [fields[1]],
    style: { fontSize: '14px', smallFontSize: '11px', gap: '9px' },
  });
});
it('rejects duplicate definitions, unknown or duplicate IDs, invalid fields and invalid overrides', () => {
  expect(() => resolvePropertyPanel([fields[0], fields[0]], { fieldIds: ['a'] })).toThrow();
  expect(() => resolvePropertyPanel(fields, { fieldIds: ['a', 'a'] })).toThrow();
  expect(() => resolvePropertyPanel(fields, { fieldIds: ['unknown' as 'a'] })).toThrow();
  expect(() => resolvePropertyPanel(fields, { fieldIds: ['a'] }, { fieldIds: ['b'] })).toThrow();
  expect(() =>
    resolvePropertyPanel([{ id: 'a', label: 'A', maxLength: 0 }], { fieldIds: ['a'] }),
  ).toThrow();
  expect(() => resolvePropertyPanel(fields, { fieldIds: ['a'], style: { gap: '' } })).toThrow();
  expect(() =>
    resolvePropertyPanel(fields, { fieldIds: ['a'], style: { unknown: '1px' } as never }),
  ).toThrow();
});

it.each(['toString', 'constructor'])('rejects inherited style key %s at either level', (key) => {
  const style = { [key]: 'invalid-key' };
  expect(() => resolvePropertyPanel(fields, { fieldIds: ['a'], style })).toThrow(
    'Invalid style override',
  );
  expect(() => resolvePropertyPanel(fields, { fieldIds: ['a'] }, { style })).toThrow(
    'Invalid style override',
  );
});
