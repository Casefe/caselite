// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AgentResponse } from '../../preload/caselite-api';
import AgentPanel from './AgentPanel';

vi.mock('./PdfReader', () => ({
  default: ({ name, onClose }: { name: string; onClose(): void }) => (
    <div>
      阅读：{name}
      <button onClick={onClose}>关闭原件</button>
    </div>
  ),
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const nativeShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const nativeClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
afterEach(() => {
  cleanup();
  for (const [name, descriptor] of [
    ['showModal', nativeShow],
    ['close', nativeClose],
  ] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  window.history.replaceState(null, '', '/');
});

it('shows saved audit output and controlled copy without any composer or new dispatch', async () => {
  window.history.replaceState(null, '', '?audit-agent=1');
  const response: AgentResponse = {
    ok: true,
    configured: true,
    model: 'deepseek-flash',
    providers: { openai: false, deepseek: true },
    runs: [
      {
        id: '12121212-1212-4212-8212-121212121212',
        scope: 'home',
        prompt: '合成输入',
        output: '## 已保存的验收回答\n\n待人工核对。',
        model: 'deepseek-flash',
        provider: 'deepseek',
        status: 'succeeded',
        sequence: 1,
        message: '生成完成，内容待人工核对。',
        usage: null,
      },
    ],
  };
  const agent = vi.fn<Window['caselite']['agent']>().mockResolvedValue(response);
  window.caselite = { agent } as unknown as Window['caselite'];
  const view = render(<AgentPanel scope="home" />);
  await screen.findByRole('heading', { name: '已保存的验收回答' });
  expect(screen.getByText(/AI 验收记录（只读）/)).toBeTruthy();
  expect(view.container.querySelector('form, textarea')).toBeNull();
  expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '复制' }));
  await screen.findByRole('button', { name: '已复制' });
  expect(agent).toHaveBeenCalledWith({
    protocol_version: 1,
    operation: 'copy_output',
    scope: 'home',
    run_id: '12121212-1212-4212-8212-121212121212',
  });
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
});

it('opens and closes a saved attachment while the audit composer remains absent', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  window.history.replaceState(null, '', '?audit-agent=1');
  const agent = vi.fn<Window['caselite']['agent']>().mockResolvedValue({
    ok: true,
    configured: true,
    model: 'deepseek-flash',
    providers: { deepseek: true },
    runs: [
      {
        id: '12121212-1212-4212-8212-121212121212',
        scope: 'home',
        prompt: '核对合成附件',
        output: '已保存的回答',
        model: 'deepseek-flash',
        provider: 'deepseek',
        status: 'succeeded',
        sequence: 1,
        message: '待人工核对',
        usage: null,
        attachments: [
          {
            source_id: '22222222-2222-4222-8222-222222222222',
            task_id: '33333333-3333-4333-8333-333333333333',
            name: '合成附件.pdf',
            pages: [1],
          },
        ],
      },
    ],
  });
  const material = vi.fn<Window['caselite']['material']>().mockImplementation(async (request) => ({
    ok: true,
    materials: [],
    ...(request.operation === 'read' ? { data: new Uint8Array([1, 2, 3]) } : {}),
  }));
  window.caselite = { agent, material } as unknown as Window['caselite'];
  const view = render(<AgentPanel scope="home" />);
  fireEvent.click(await screen.findByRole('button', { name: /合成附件.pdf/ }));
  await screen.findByText('阅读：合成附件.pdf');
  expect(screen.getByRole('dialog', { name: '材料原件' })).toBeTruthy();
  expect(material).toHaveBeenCalledWith({
    protocol_version: 1,
    operation: 'read',
    scope: '33333333-3333-4333-8333-333333333333',
    source_id: '22222222-2222-4222-8222-222222222222',
  });
  expect(view.container.querySelector('form, textarea')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '关闭原件' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
});
