// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SidebarAgent from './SidebarAgent';

vi.mock('./AgentPanel', () => ({
  default: function MockAgentPanel({
    scope,
    page,
    renderRun,
  }: {
    scope: string;
    page: { version: string; archived: boolean };
    renderRun?: () => unknown;
  }) {
    const [draft, setDraft] = useState('');
    return (
      <div>
        <span>
          {scope} / {page.version} / {String(page.archived)} / {String(Boolean(renderRun))}
        </span>
        <input aria-label="草稿" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>
    );
  },
  UnavailableAgentPanel: ({ reason }: { reason: string }) => <span>{reason}</span>,
}));
afterEach(cleanup);

it('preserves the same object on revision and isolates another object while keeping precedence', () => {
  const renderRun = () => null;
  const contact = { id: 'c', version: 1 };
  const project = { id: 'p', version: 3, archived: true };
  const document = { id: 'd', revision: 5, archived: false };
  const view = render(
    <SidebarAgent
      contact={contact}
      project={project}
      document={document}
      taskId="t"
      renderRun={renderRun}
      blocked
    />,
  );
  expect(screen.getByText('contact:c / 1 / false / true')).toBeTruthy();
  expect(screen.getByLabelText('草稿').parentElement?.parentElement?.hasAttribute('inert')).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText('草稿'), { target: { value: '保留' } });
  view.rerender(
    <SidebarAgent
      contact={{ ...contact, version: 2 }}
      project={project}
      document={document}
      taskId="t"
      renderRun={renderRun}
    />,
  );
  expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('保留');
  expect(screen.getByText('contact:c / 2 / false / true')).toBeTruthy();
  view.rerender(
    <SidebarAgent project={project} document={document} taskId="t" renderRun={renderRun} />,
  );
  expect(screen.getByText('project:p / 3 / true / false')).toBeTruthy();
  expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('');
  view.rerender(<SidebarAgent document={document} taskId="t" />);
  expect(screen.getByText('document:d / 5 / false / false')).toBeTruthy();
  view.rerender(<SidebarAgent taskId="t" />);
  expect(screen.getByText('t / t / false / false')).toBeTruthy();
  view.rerender(<SidebarAgent unavailable="无关联" />);
  expect(screen.getByText('无关联')).toBeTruthy();
});
