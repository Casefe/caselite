// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createAgentApplication,
  createAppearanceApplication,
  type AgentRuntimePort,
} from '@caselite/application';
import type { AgentResponse, AgentRun, Theme } from '../../../preload/caselite-api';
import { AppearanceProvider, ThemeSetting } from '../../ui/Appearance';
import { ThemeCommandCard } from './ThemeCommandCard';

afterEach(() => {
  cleanup();
  delete window.caseliteAppearance;
});
async function setup(complete = true) {
  let theme: Theme = 'light',
    failRecord = false,
    failApplied = false;
  const write = vi.fn((value: Theme) => {
    theme = value;
  });
  const appearance = createAppearanceApplication({ read: () => theme, write });
  const stored = new Map<string, AgentRun>();
  let input!: Parameters<AgentRuntimePort['start']>[0];
  const app = createAgentApplication({
    appearance,
    taskExists: () => false,
    credentials: {
      get: () => 'synthetic-only',
      set() {},
      clear() {},
      getDefaultModel: () => 'gpt-4.1-mini',
      setDefaultModel() {},
    },
    runtime: {
      start(value) {
        input = value;
        return { cancel() {} };
      },
    },
    history: {
      load: () => [],
      register(run) {
        stored.set(run.id, structuredClone(run));
        return { created: true, run };
      },
      save(run) {
        if (failRecord) throw Error('Synthetic record failure');
        stored.set(run.id, structuredClone(run));
      },
    },
  });
  const id = crypto.randomUUID();
  await app.execute(
    {
      protocol_version: 1,
      operation: 'start',
      scope: 'home',
      run_id: id,
      prompt: '调成深色',
      model: 'gpt-4.1-mini',
      confirmed: true,
    },
    'A',
  );
  const finish = () => {
    input.theme!.propose({ theme: 'dark' });
    input.onEnd({ status: 'succeeded', usage: null, message: '' });
  };
  if (complete) finish();
  window.caseliteAppearance = { ok: true, theme: 'light' };
  window.caselite = {
    agent: (request) => app.execute(request, 'A'),
    appearance: async (request) =>
      request.operation === 'applied' && failApplied
        ? { ok: false, message: '原生外观同步失败' }
        : appearance.execute(request),
  } as Window['caselite'];
  const tree = () => (
    <AppearanceProvider>
      <ThemeSetting />
      <ThemeCommandCard command={stored.get(id)!.theme_command!} runId={id} />
    </AppearanceProvider>
  );
  const view = () => render(tree());
  return {
    app,
    write,
    stored,
    id,
    view,
    tree,
    finish,
    failRecord(value: boolean) {
      failRecord = value;
    },
    failApplied(value: boolean) {
      failApplied = value;
    },
  };
}

it('shows a confirmed saved/applied result, then marks the old card superseded after a manual setting', async () => {
  const f = await setup();
  f.view();
  await screen.findByText('深色主题已保存并应用');
  fireEvent.click(screen.getByRole('button', { name: '浅色' }));
  await screen.findByText('当时已保存；当前选择已被后续设置取代');
  expect(screen.queryByText('主题已保存，界面尚待同步')).toBeNull();
  expect((screen.getByRole('button', { name: '撤销本次修改' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(f.write).toHaveBeenCalledTimes(2);
});

it('updates a registered pending command when the same Run receives its saved result', async () => {
  const f = await setup(false),
    view = f.view();
  await screen.findByText('等待模型提出本次已授权的主题操作。');
  await act(async () => {
    f.finish();
    view.rerender(f.tree());
  });
  await screen.findByText('深色主题已保存并应用');
  expect(f.write).toHaveBeenCalledTimes(1);
});

it('keeps an initial terminal save failure visible until readback repairs the record', async () => {
  const f = await setup(false);
  f.failRecord(true);
  f.finish();
  f.view();
  await screen.findByText('深色主题已保存并应用');
  expect((await screen.findAllByText(/运行记录尚未保存/)).length).toBeGreaterThan(0);
  expect(f.stored.get(f.id)?.theme_command?.state).toBe('pending');
  f.failRecord(false);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '核对结果' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '核对结果' }));
  await waitFor(() => expect(screen.queryByText(/运行记录尚未保存/)).toBeNull());
  expect(f.stored.get(f.id)?.theme_command?.state).toBe('saved');
  expect(f.write).toHaveBeenCalledTimes(1);
});

it('shows actual undo separately from a failed Run save, and fixes history without a second theme write', async () => {
  const f = await setup();
  f.view();
  await screen.findByText('深色主题已保存并应用');
  f.failRecord(true);
  fireEvent.click(screen.getByRole('button', { name: '撤销本次修改' }));
  await screen.findByText('已撤销本次主题修改');
  expect((await screen.findAllByText(/运行记录尚未保存/)).length).toBeGreaterThan(0);
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(f.stored.get(f.id)?.theme_command?.state).toBe('saved');
  f.failRecord(false);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '核对结果' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '核对结果' }));
  await waitFor(() => expect(screen.queryByText(/运行记录尚未保存/)).toBeNull());
  expect(f.stored.get(f.id)?.theme_command?.state).toBe('undone');
  expect(f.write).toHaveBeenCalledTimes(2);
});

it('does not present a successful native application when window synchronization fails', async () => {
  const f = await setup();
  f.failApplied(true);
  f.view();
  await screen.findByText('主题已保存，界面尚待同步');
  expect(screen.queryByText('深色主题已保存并应用')).toBeNull();
  expect((await screen.findAllByText('原生外观同步失败')).length).toBeGreaterThan(0);
  f.failApplied(false);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '核对结果' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '核对结果' }));
  await screen.findByText('深色主题已保存并应用');
  expect(f.write).toHaveBeenCalledTimes(1);
});

it('keeps expired history descriptive and refuses to revive an undo capability', async () => {
  const f = await setup();
  f.app.release('A');
  f.view();
  await screen.findByText('历史操作：当时已保存主题');
  expect((screen.getByRole('button', { name: '撤销本次修改' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(f.write).toHaveBeenCalledTimes(1);
});

it('ignores an old saved response delivered after a newer manual choice was verified', async () => {
  const f = await setup();
  f.view();
  await screen.findByText('深色主题已保存并应用');
  const original = window.caselite.agent;
  let release!: () => void;
  let hold = true;
  window.caselite = {
    ...window.caselite,
    agent: async (request) => {
      const result: AgentResponse = await original(request);
      if (request.operation === 'theme_status' && hold) {
        hold = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return result;
    },
  };
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '核对结果' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '核对结果' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '浅色' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '浅色' }));
  await screen.findByText('当时已保存；当前选择已被后续设置取代');
  await act(async () => {
    release();
  });
  expect(screen.getByText('当时已保存；当前选择已被后续设置取代')).toBeTruthy();
  expect(screen.queryByText('主题已保存，界面尚待同步')).toBeNull();
  expect(f.write).toHaveBeenCalledTimes(2);
});
