import { describe, expect, it, vi } from 'vitest';
import type { LegalBundle, LegalReceipt } from '@caselite/contracts';
import { createLegalConsentApplication } from './legal-consent-application';

const bundle: LegalBundle = {
  effective_date: '2026-11-09',
  document_set_hash: 'a'.repeat(64),
  documents: [
    { id: 'license', title: '许可证', text: '许可全文', sha256: 'b'.repeat(64) },
    { id: 'eula', title: '用户协议', text: '协议全文', sha256: 'c'.repeat(64) },
  ],
};
const accept = {
  protocol_version: 1,
  operation: 'accept',
  document_set_hash: bundle.document_set_hash,
  confirmed: true,
  reviewed_documents: ['license', 'eula'],
};
function setup() {
  let stored: LegalReceipt | null = null;
  const port = {
    read: vi.fn(() => stored),
    write: vi.fn((r: LegalReceipt) => {
      stored = r;
    }),
  };
  return {
    port,
    app: createLegalConsentApplication(port, bundle, () => new Date('2026-11-09T10:00:00Z')),
  };
}
describe('legal acceptance application', () => {
  it('requires both documents, the current hash and an explicit affirmative action', () => {
    const { app, port } = setup();
    for (const bad of [
      null,
      { ...accept, confirmed: false },
      { ...accept, reviewed_documents: ['license'] },
      { ...accept, document_set_hash: 'd'.repeat(64) },
      { ...accept, path: '/outside' },
      { ...accept, protocol_version: 0 },
    ])
      expect(app.execute(bad).ok).toBe(false);
    expect(port.write).not.toHaveBeenCalled();
    expect(app.execute({ protocol_version: 1, operation: 'read' })).toMatchObject({
      ok: true,
      accepted: false,
    });
    expect(app.execute({ protocol_version: 1, operation: 'decline' })).toMatchObject({
      ok: true,
      accepted: false,
    });
    expect(port.write).not.toHaveBeenCalled();
  });
  it('confirms readback, preserves the original acceptance time and prompts after either document changes', () => {
    const { app, port } = setup();
    expect(app.execute(accept)).toMatchObject({ ok: true, accepted: true });
    expect(port.read()?.accepted_at).toBe('2026-11-09T10:00:00.000Z');
    expect(app.execute(accept)).toMatchObject({ ok: true, accepted: true });
    expect(port.write).toHaveBeenCalledTimes(1);
    const updated = structuredClone(bundle);
    updated.documents[1].sha256 = 'e'.repeat(64);
    expect(
      createLegalConsentApplication(port, updated).execute({
        protocol_version: 1,
        operation: 'read',
      }),
    ).toMatchObject({ ok: true, accepted: false });
  });
  it('does not report acceptance on read, write or readback failure', () => {
    const { app, port } = setup();
    port.write.mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(app.execute(accept).ok).toBe(false);
    port.write.mockImplementation(() => {});
    expect(app.execute(accept).ok).toBe(false);
    port.read.mockImplementation(() => {
      throw new Error('corrupt receipt');
    });
    expect(app.execute({ protocol_version: 1, operation: 'read' }).ok).toBe(false);
  });
});
