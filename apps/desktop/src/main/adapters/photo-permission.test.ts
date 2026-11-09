import { expect, it, vi } from 'vitest';
import { createPhotoPermissionGate } from './photo-permission';
import { imageDimensions } from './image-dimensions';
it('only grants a trusted live window video after explicit system consent, expires and revokes while denying audio and other origins', async () => {
  let now = 1000;
  const destroyed = vi.fn();
  const window = {
    id: 1,
    isDestroyed: () => false,
    once: vi.fn((_event: string, listener: () => void) => {
      destroyed.mockImplementation(listener);
    }),
  };
  const other = { ...window, id: 2 };
  const askSystem = vi.fn(async () => true);
  const gate = createPhotoPermissionGate({
    trusted: (value) => value === window,
    askSystem,
    now: () => now,
  });
  expect(gate.permits(window, 'media', { mediaType: 'video' })).toBe(false);
  expect(await gate.prepare(other)).toBe(false);
  expect(askSystem).not.toHaveBeenCalled();
  expect(await gate.prepare(window)).toBe(true);
  expect(gate.permits(window, 'media', { mediaType: 'video' })).toBe(true);
  for (const details of [{ mediaType: 'audio' }, { mediaTypes: ['video', 'audio'] }, {}])
    expect(gate.permits(window, 'media', details)).toBe(false);
  expect(gate.permits(other, 'media', { mediaType: 'video' })).toBe(false);
  expect(gate.permits(window, 'geolocation', {})).toBe(false);
  expect(gate.permits(window, 'media', { mediaType: 'video', isMainFrame: false })).toBe(false);
  now += 30001;
  expect(gate.permits(window, 'media', { mediaType: 'video' })).toBe(false);
  await gate.prepare(window);
  gate.revoke(window);
  expect(gate.permits(window, 'media', { mediaType: 'video' })).toBe(false);
  await gate.prepare(window);
  destroyed();
  expect(gate.permits(window, 'media', { mediaType: 'video' })).toBe(false);
  const denied = createPhotoPermissionGate({ trusted: () => true, askSystem: async () => false });
  expect(await denied.prepare(window)).toBe(false);
  expect(denied.permits(window, 'media', { mediaType: 'video' })).toBe(false);
});
it('bounds PNG/JPEG dimensions before decoding or OCR and rejects truncated or oversized headers', () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 1200);
  view.setUint32(20, 800);
  expect(imageDimensions(png)).toEqual({ width: 1200, height: 800 });
  view.setUint32(16, 20000);
  expect(() => imageDimensions(png)).toThrow();
  const jpeg = Uint8Array.from([255, 216, 255, 192, 0, 8, 8, 3, 32, 4, 176, 3]);
  expect(imageDimensions(jpeg)).toEqual({ width: 1200, height: 800 });
  for (const bad of [
    new Uint8Array(),
    png.subarray(0, 20),
    jpeg.subarray(0, 7),
    Uint8Array.from([255, 216, 255, 192, 0, 1, 0, 0]),
  ])
    expect(() => imageDimensions(bad)).toThrow();
});
