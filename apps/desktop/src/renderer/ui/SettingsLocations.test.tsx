// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalPreferencesProvider, initialLocalPreferences } from '../shared/data/LocalPreferences';
import SettingsView from './SettingsView';
vi.mock('./Appearance', () => ({ ThemeSetting: () => null }));
vi.mock('./ModelSettings', () => ({ default: () => null }));
afterEach(cleanup);
it('displays host-bound current locations without offering path input or submitting writes', async () => {
  const preferences = vi.fn(async () => ({
    ok: true,
    preferences: initialLocalPreferences,
    receipt: null,
    locations: {
      database_file: '/synthetic/current/caselite.sqlite',
      output_directory: '/synthetic/current/delivery-exports',
    },
  }));
  Object.defineProperty(window, 'caselite', { configurable: true, value: { preferences } });
  render(
    <LocalPreferencesProvider>
      <SettingsView section="general" onSection={vi.fn()} onBack={vi.fn()} />
    </LocalPreferencesProvider>,
  );
  expect(await screen.findByText('/synthetic/current/caselite.sqlite')).toBeTruthy();
  expect(screen.getByText('/synthetic/current/delivery-exports')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: '数据库位置' })).toBeNull();
  expect(preferences).toHaveBeenCalledExactlyOnceWith({ protocol_version: 1, operation: 'read' });
});
