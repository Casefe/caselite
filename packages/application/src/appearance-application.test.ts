import { describe, expect, it, vi } from 'vitest';
import { createAppearanceApplication } from './appearance-application';

describe('appearance commands', () => {
  it('validates input and reports storage errors without inventing a successful save', () => {
    const port = { read: vi.fn(() => 'light' as const), write: vi.fn() };
    const app = createAppearanceApplication(port);
    expect(app.execute({ protocol_version: 1, operation: 'set', theme: 'other' }).ok).toBe(false);
    expect(port.write).not.toHaveBeenCalled();
    expect(app.execute({ protocol_version: 1, operation: 'read' })).toEqual({
      ok: true,
      theme: 'light',
    });
    port.write.mockImplementation(() => {
      throw new Error('disk failure');
    });
    expect(app.execute({ protocol_version: 1, operation: 'set', theme: 'dark' }).ok).toBe(false);
  });
});
