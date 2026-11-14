// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditorConversation from './EditorConversation';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);

it('restores the controlled question after submission clears the composer', async () => {
  const send = vi.fn();
  const props = {
    messages: [],
    question: '初始问题',
    onQuestion: vi.fn(),
    send,
    stop: vi.fn(),
    running: false,
    disabled: false,
  };
  const view = render(<EditorConversation {...props} />);
  const input = screen.getByRole('textbox', { name: '本轮问题' }) as HTMLTextAreaElement;
  expect(input.maxLength).toBe(4000);
  view.rerender(<EditorConversation {...props} question="外部更新" />);
  expect(screen.getByRole('textbox', { name: '本轮问题' })).toBe(input);
  expect(input.value).toBe('外部更新');
  fireEvent.click(screen.getByRole('button', { name: '发送本轮审阅' }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(input.value).toBe('外部更新'));
  fireEvent.click(screen.getByRole('button', { name: '发送本轮审阅' }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
});
