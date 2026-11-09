// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { LegalBundle, LegalConsentRequest } from '../preload/caselite-api';
import { mountLegalConsent } from './legal-consent-ui';

const bundle: LegalBundle = {
  effective_date: '2026-11-09',
  document_set_hash: 'a'.repeat(64),
  documents: [
    {
      id: 'license',
      title: '许可',
      text: '# 许可\n\n<script>unsafe()</script>',
      sha256: 'b'.repeat(64),
    },
    { id: 'eula', title: '协议', text: '# 协议\n\n**收费法律服务允许**', sha256: 'c'.repeat(64) },
  ],
};
afterEach(() => {
  document.body.replaceChildren();
});
describe('explicit legal agreement UI', () => {
  it('requires reading both texts and an unchecked-by-default checkbox, preserving the gate on save failure', async () => {
    document.documentElement.innerHTML = readFileSync(
      'apps/desktop/src/renderer/legal-window.html',
      'utf8',
    );
    const execute = vi.fn(async (r: LegalConsentRequest) =>
      r.operation === 'accept'
        ? { ok: false as const, message: '保存失败' }
        : { ok: true as const, accepted: false, bundle },
    );
    mountLegalConsent(document, { execute });
    const accept = document.querySelector<HTMLButtonElement>('#legal-accept')!;
    const confirm = document.querySelector<HTMLInputElement>('#legal-confirm')!;
    const mark = document.querySelector<HTMLButtonElement>('#legal-mark-read')!;
    await waitFor(() => expect(mark.disabled).toBe(false));
    expect(accept.disabled).toBe(true);
    expect(confirm.checked).toBe(false);
    expect(document.querySelector('#legal-document script')).toBeNull();
    expect(document.querySelector('#legal-document')?.textContent).toContain(
      '<script>unsafe()</script>',
    );
    mark.click();
    expect(confirm.disabled).toBe(true);
    expect(document.querySelector('#legal-document strong')?.textContent).toBe('收费法律服务允许');
    mark.click();
    expect(confirm.disabled).toBe(false);
    expect(accept.disabled).toBe(true);
    confirm.click();
    expect(accept.disabled).toBe(false);
    accept.click();
    await waitFor(() =>
      expect(document.querySelector('#legal-error')?.textContent).toBe('保存失败'),
    );
    expect(execute).toHaveBeenLastCalledWith({
      protocol_version: 1,
      operation: 'accept',
      document_set_hash: bundle.document_set_hash,
      confirmed: true,
      reviewed_documents: ['license', 'eula'],
    });
    expect(document.querySelector('#legal-confirm')).not.toBeNull();
  });
});
