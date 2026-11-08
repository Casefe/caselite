// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Matter } from '../../../preload/caselite-api';
import ProjectList, { projectListDefaults } from './ProjectList';

afterEach(cleanup);
const projects: Matter[] = ['甲项目', '乙项目'].map((title, index) => ({
  id: String(index),
  title,
  status: 'planned',
  version: 1,
  archived_at: null,
  body_id: `body-${index}`,
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-08T00:00:00Z',
  task_count: 0,
  outstanding_cents: 20000,
}));
function setup(disabled = false) {
  const actions = {
    onOrder: vi.fn(),
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onPreview: vi.fn(),
    onFinance: vi.fn(),
  };
  render(
    <ProjectList
      projects={projects}
      columns={projectListDefaults}
      disabled={disabled}
      selectedId="0"
      order="updated"
      {...actions}
    />,
  );
  return actions;
}
it('keeps pointer preview, keyboard opening, and finance navigation bound to the selected identity', () => {
  const actions = setup();
  const table = screen.getByRole('table', { name: '项目列表' });
  const rows = within(table).getAllByRole('row').slice(1);
  fireEvent.click(rows[1]);
  expect(actions.onSelect).toHaveBeenCalledExactlyOnceWith(projects[1]);
  expect(actions.onOpen).not.toHaveBeenCalled();
  rows[0].focus();
  fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(rows[1]);
  fireEvent.keyDown(rows[1], { key: ' ' });
  expect(actions.onPreview).toHaveBeenCalledExactlyOnceWith(projects[1]);
  fireEvent.keyDown(rows[1], { key: 'Enter' });
  expect(actions.onOpen).toHaveBeenCalledExactlyOnceWith(projects[1]);
  fireEvent.click(screen.getByRole('button', { name: '查看 甲项目 的待收款 200.00 元' }));
  expect(actions.onFinance).toHaveBeenCalledExactlyOnceWith('0');
  expect(actions.onSelect).toHaveBeenCalledTimes(1);
});
it('does not navigate or alter sorting while a project save is unresolved', () => {
  const actions = setup(true);
  const row = screen.getAllByRole('row')[1];
  fireEvent.click(row);
  fireEvent.keyDown(row, { key: 'Enter' });
  fireEvent.keyDown(row, { key: ' ' });
  fireEvent.click(screen.getByRole('button', { name: '按项目名称排序' }));
  Object.values(actions).forEach((action) => expect(action).not.toHaveBeenCalled());
});
