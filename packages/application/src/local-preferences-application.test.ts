import { expect, it, vi } from 'vitest';
import { defaultLocalPreferences } from '@caselite/contracts';
import { createLocalPreferencesApplication } from './local-preferences-application';
const locations = {
  database_file: '/synthetic/workspace/caselite.sqlite',
  output_directory: '/synthetic/workspace/delivery-exports',
};
it('binds host locations only to successful reads and never to editable data or receipts', () => {
  const execute = vi.fn(() => ({
    ok: true as const,
    preferences: defaultLocalPreferences,
    receipt: null,
  }));
  const app = createLocalPreferencesApplication({ execute }, locations);
  expect(app.execute({ protocol_version: 1, operation: 'read' })).toEqual({
    ok: true,
    preferences: defaultLocalPreferences,
    receipt: null,
    locations,
  });
  const request = {
    protocol_version: 1,
    operation: 'set',
    request_id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
    expected_version: 0,
    values: { name: '合成用户', email: '', avatar: 'portrait', show_word_count: false },
  };
  expect(app.execute(request)).not.toHaveProperty('locations');
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: request.idempotency_key,
    }),
  ).not.toHaveProperty('locations');
  const count = execute.mock.calls.length;
  for (const input of [
    { ...request, locations },
    { ...request, path: '/other' },
    { protocol_version: 1, operation: 'read', database_file: '/other' },
  ])
    expect(app.execute(input)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(execute).toHaveBeenCalledTimes(count);
});
