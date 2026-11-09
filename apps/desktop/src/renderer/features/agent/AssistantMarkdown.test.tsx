// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { AssistantMarkdown } from './AssistantMarkdown';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);

function Message() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.Parts components={{ Text: AssistantMarkdown }} />
    </MessagePrimitive.Root>
  );
}

function Thread({ text, running = false }: { text: string; running?: boolean }) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: [{ id: 'presentation-test', role: 'assistant', content: [{ type: 'text', text }] }],
    isRunning: running,
    convertMessage: (message) => message,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages components={{ Message }} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

it('renders Chinese GFM tables and preserves code whitespace with an inert language label', async () => {
  render(
    <Thread
      text={[
        '# 审阅提纲',
        '## 付款核对',
        '| 项目 | 风险 |',
        '| --- | --- |',
        '| **付款** | 待确认 |',
        '',
        '```typescript',
        'const  amount = 100;',
        '  verify(amount);',
        '```',
      ].join('\n')}
    />,
  );
  await screen.findByRole('heading', { name: '审阅提纲', level: 1 });
  expect(screen.getByRole('heading', { name: '付款核对', level: 2 })).toBeTruthy();
  const region = screen.getByRole('region', { name: '回答中的表格' });
  expect(region.tabIndex).toBe(0);
  expect(region.querySelectorAll('th')).toHaveLength(2);
  expect(region.querySelector('td strong')?.textContent).toBe('付款');
  expect(document.querySelector('pre code')?.textContent).toBe(
    'const  amount = 100;\n  verify(amount);\n',
  );
  expect(document.querySelector('.assistant-code-heading')?.textContent).toBe('typescript');
});

it('keeps GFM autolinks, images, raw HTML and task list checkboxes non-actionable', async () => {
  const view = render(
    <Thread
      text={[
        'https://example.invalid/自动链接',
        '',
        'contact@example.invalid',
        '',
        '[脚本](javascript:alert(1)) [文件](file:///etc/passwd)',
        '',
        '![外部图片](https://example.invalid/tracker.png)',
        '',
        '<script>window.stolen = true</script>',
        '<iframe src="https://example.invalid"></iframe>',
        '<img src=x onerror="alert(1)">',
        '',
        '- [ ] 待核对',
        '- [x] 已列入清单',
      ].join('\n')}
    />,
  );
  await screen.findByText('[图片：外部图片]');
  expect(view.container.querySelector('a, img, script, iframe')).toBeNull();
  expect(screen.getByText('https://example.invalid/自动链接').tagName).toBe('SPAN');
  for (const checkbox of screen.getAllByRole<HTMLInputElement>('checkbox')) {
    expect(checkbox.disabled).toBe(true);
  }
});

it('completes partial streamed tables and fences without dropping the final text', async () => {
  const view = render(
    <Thread running text={'## 审阅\n\n| 项目 | 风险 |\n| --- | --- |\n| 付款'} />,
  );
  await screen.findByRole('heading', { name: '审阅' });
  view.rerender(
    <Thread
      running
      text={'## 审阅\n\n| 项目 | 风险 |\n| --- | --- |\n| 付款 | 待核对 |\n\n```text\n未完'}
    />,
  );
  await screen.findByRole('cell', { name: '待核对' });
  view.rerender(
    <Thread
      text={
        '## 审阅\n\n| 项目 | 风险 |\n| --- | --- |\n| 付款 | 待核对 |\n\n```text\n未完成内容保留\n```\n\n结论待人工确认。'
      }
    />,
  );
  await screen.findByText('结论待人工确认。');
  await waitFor(() =>
    expect(view.container.querySelector('pre code')?.textContent).toBe('未完成内容保留\n'),
  );
  expect(view.container.querySelectorAll('table')).toHaveLength(1);
});
