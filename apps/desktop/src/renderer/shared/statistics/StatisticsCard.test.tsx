// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import StatisticsCard, { statisticsProgress } from './StatisticsCard';
import { statisticsPreferences, useStatisticsCards } from './statistics-preferences';
import {
  LocalPreferencesProvider,
  initialLocalPreferences,
} from '../../shared/data/LocalPreferences';
import PersonalSettings from '../../ui/PersonalSettings';
import InspectorCards from '../../ui/InspectorCards';
import TaskListSummary from '../../features/tasks/TaskListSummary';
import ProjectMetrics from '../../features/projects/ProjectMetrics';
import type {
  Task,
  Matter,
  LocalPreferencesRequest,
  LocalPreferences,
} from '../../../preload/caselite-api';
import { localPreferenceValuesSchema } from '@caselite/contracts';

afterEach(cleanup);
it('uses integer ratios without changing the displayed amount and leaves a missing base unknown', () => {
  expect(statisticsProgress(4n, 10n)).toBe(40);
  expect(statisticsProgress(9999999999999999999n, 10000000000000000000n)).toBe(99.99);
  expect(statisticsProgress(3n, 0n)).toBeNull();
  expect(statisticsProgress(12n, 10n)).toBe(100);
  expect(statisticsProgress(-1n, 10n)).toBe(0);
  render(
    <StatisticsCard
      module="finance"
      title="合成统计"
      totalLabel="总收入"
      total="10.00"
      rows={[{ label: '已开票', value: '12.00', progress: 100, tone: 'blue' }]}
    />,
  );
  expect(screen.getByText('12.00')).toBeTruthy();
  expect(document.querySelector<HTMLElement>('.statistics-card-bar')?.style.width).toBe('100%');
});

it('keeps task canceled totals and excludes archived projects through their original consumers', () => {
  const tasks = [null, 'todo', 'in_progress', 'done', 'canceled'].map((status) => ({
    status,
  })) as Task[];
  const projects = [
    { status: 'active' },
    { status: 'planned' },
    { status: 'done' },
    { status: 'active', archived_at: '2026-11-10' },
  ] as Matter[];
  render(
    <>
      <TaskListSummary tasks={tasks} variant="stats" disabled={false} onOpen={vi.fn()} />
      <ProjectMetrics projects={projects} unavailable={false} />
    </>,
  );
  const values = (name: string) =>
    [
      ...screen
        .getByRole('region', { name })
        .querySelectorAll('[data-statistic-total], .statistics-card-value'),
    ].map((node) => node.textContent);
  expect(values('任务统计')).toEqual(['5', '2', '1', '1']);
  expect(values('项目统计')).toEqual(['3', '1', '1', '1']);
});

it('requires a complete strict configuration without changing an old request shape', () => {
  const { version, ...values } = initialLocalPreferences;
  void version;
  expect(localPreferenceValuesSchema.parse(values)).toEqual(values);
  const config = statisticsPreferences(undefined);
  expect(
    localPreferenceValuesSchema.safeParse({ ...values, statistics_cards: config }).success,
  ).toBe(true);
  expect(
    localPreferenceValuesSchema.safeParse({ ...values, statistics_cards: { tasks: config.tasks } })
      .success,
  ).toBe(false);
  expect(
    localPreferenceValuesSchema.safeParse({
      ...values,
      statistics_cards: { ...config, tasks: { enabled: true, position: 'left' } },
    }).success,
  ).toBe(false);
  expect(
    localPreferenceValuesSchema.safeParse({
      ...values,
      statistics_cards: { ...config, finance: { ...config.finance, secret: 'x' } },
    }).success,
  ).toBe(false);
});

it('saves module toggles and positions through the existing controller and keeps contacts inactive after restored true', async () => {
  let persisted: LocalPreferences = {
    ...initialLocalPreferences,
    statistics_cards: {
      ...statisticsPreferences(undefined),
      contacts: { enabled: true, position: 'bottom' },
    },
  };
  const api = vi.fn(async (request: LocalPreferencesRequest) => {
    if (request.operation === 'read')
      return { ok: true, preferences: structuredClone(persisted), receipt: null };
    if (request.operation !== 'set') throw new Error('Unexpected retry');
    persisted = { ...request.values, version: request.expected_version + 1 };
    return { ok: true, preferences: structuredClone(persisted), receipt: request.idempotency_key };
  });
  window.caselite = { preferences: api } as unknown as Window['caselite'];
  function Cards() {
    const cards = useStatisticsCards('tasks', <p>合成任务卡</p>);
    const contacts = useStatisticsCards('contacts', <p>不应显示的联系人卡</p>);
    return (
      <InspectorCards
        properties={<input aria-label="原属性" defaultValue="保留属性" />}
        cards={[...cards, ...contacts]}
      />
    );
  }
  function Host() {
    const [settings, setSettings] = useState(true);
    return (
      <>
        <button onClick={() => setSettings(!settings)}>切换设置</button>
        {settings && <PersonalSettings preferencesOnly />}
        <Cards />
      </>
    );
  }
  render(
    <LocalPreferencesProvider>
      <Host />
    </LocalPreferencesProvider>,
  );
  await screen.findByText('合成任务卡');
  await waitFor(() =>
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '启用任务统计' }).disabled).toBe(
      false,
    ),
  );
  const original = screen.getByLabelText('原属性');
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '启用联系人统计' }).disabled).toBe(
    true,
  );
  expect(screen.queryByText('不应显示的联系人卡')).toBeNull();
  for (const position of ['middle', 'bottom', 'top']) {
    fireEvent.change(screen.getByLabelText('任务统计位置'), { target: { value: position } });
    fireEvent.click(screen.getByRole('button', { name: '保存个人设置' }));
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-inspector-card="tasks-statistics"]')
          ?.getAttribute('data-card-position'),
      ).toBe(position),
    );
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存个人设置' }).disabled).toBe(
        true,
      ),
    );
    expect(screen.getByLabelText('原属性')).toBe(original);
  }
  fireEvent.click(screen.getByRole('checkbox', { name: '启用任务统计' }));
  fireEvent.click(screen.getByRole('button', { name: '保存个人设置' }));
  await waitFor(() => expect(screen.queryByText('合成任务卡')).toBeNull());
  expect(persisted.statistics_cards?.projects).toEqual({ enabled: true, position: 'top' });
  expect(persisted.statistics_cards?.contacts.enabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '切换设置' }));
  fireEvent.click(screen.getByRole('button', { name: '切换设置' }));
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '启用任务统计' }).checked).toBe(
    false,
  );
  expect(
    within(screen.getByRole('group', { name: '右侧统计卡片' })).getByText('联系人（暂不启用）'),
  ).toBeTruthy();
});
