// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IntakeRequest, WorkRequest } from '../../../preload/caselite-api';
import IntakeView from './IntakeView';

afterEach(() => {
  cleanup();
  delete (window as { caselite?: unknown }).caselite;
});

it('keeps a typed request out of tasks until an explicit accept, and ignores a second click while busy', async () => {
  const requests: WorkRequest[] = [];
  let acceptCalls = 0;
  let release: (() => void) | undefined;
  window.caselite = {
    intake: vi.fn(async (request: IntakeRequest) => {
      if (request.operation === 'list') return { ok: true, requests: [...requests], receipt: null };
      if (request.operation === 'submit') {
        requests.unshift({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          title: request.title,
          text: request.text,
          source: 'local_manual',
          status: 'pending',
          attachment_draft_id: null,
          target_task_id: null,
          target_task_version: null,
          duplicate_of_request_id: null,
          snooze_until: null,
          snooze_due: false,
          version: 1,
          updated_at: '2026-11-16T00:00:00.000Z',
        });
        return { ok: true, requests: [requests[0]], receipt: request.idempotency_key };
      }
      if (request.operation === 'accept_create') {
        acceptCalls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        requests[0] = {
          ...requests[0]!,
          status: 'accepted',
          target_task_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          target_task_version: 1,
        };
        return {
          ok: true,
          requests: [requests[0]],
          receipt: request.idempotency_key,
          task_id: requests[0]!.target_task_id!,
        };
      }
      return { ok: false, code: 'INVALID_REQUEST', message: '未使用的操作。' };
    }),
  } as unknown as Window['caselite'];
  const onOpen = vi.fn();
  render(<IntakeView onOpen={onOpen} />);
  expect(await screen.findByRole('heading', { name: '收件' })).toBeTruthy();
  expect(screen.getByText(/不会创建任务/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('请求标题'), { target: { value: '来访记录' } });
  fireEvent.change(screen.getByLabelText('请求说明'), { target: { value: '先不要立任务' } });
  fireEvent.click(screen.getByRole('button', { name: '放入收件区' }));
  expect(await screen.findByText('待分拣')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '接受并创建任务' }));
  fireEvent.click(screen.getByRole('button', { name: '接受并创建任务' }));
  expect(acceptCalls).toBe(1);
  release?.();
  expect(await screen.findByText('已采纳')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '接受并创建任务' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开任务' }));
  expect(onOpen).toHaveBeenCalledWith('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
});
