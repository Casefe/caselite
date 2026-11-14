// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useId, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspacePageChrome, { closeWorkspaceDisplayOnEscape } from './WorkspacePageChrome';

afterEach(cleanup);

it.each([
  ['日历', '新建日历'],
  ['任务', '新建任务'],
  ['项目', '新建项目'],
  ['文档', '新建文档'],
  ['财务', '新建记账'],
  ['联系人', '新建联系人'],
])('keeps %s title and creation callback owned by its consumer', (title, label) => {
  const create = vi.fn();
  render(<WorkspacePageChrome title={title} createLabel={label} create={{ onClick: create }} />);
  expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(create).toHaveBeenCalledOnce();
});

it('exposes unavailable actions without implying an operation was executed', () => {
  render(
    <WorkspacePageChrome
      title="文档"
      createLabel="新建文档"
      create={{ unavailableReason: '文档创建入口尚未接入' }}
    />,
  );
  const create = screen.getByRole('button', { name: '新建文档' });
  expect(create.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(create.getAttribute('aria-describedby')!)?.textContent).toBe(
    '文档创建入口尚未接入',
  );
  const search = screen.getByRole('button', { name: '文档搜索' });
  expect(search.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(search.getAttribute('aria-describedby')!)?.textContent).toBe(
    '文档暂不支持搜索',
  );
});

it('closes the caller-owned panel on Escape and restores focus without unmounting its input', () => {
  function Fixture() {
    const [open, setOpen] = useState(false);
    const id = useId();
    return (
      <>
        <WorkspacePageChrome
          title="任务"
          createLabel="新建任务"
          create={{ onClick() {} }}
          filter={{ expanded: open, controls: id, onClick: () => setOpen((value) => !value) }}
        />
        <div id={id} hidden={!open}>
          <input aria-label="筛选输入" defaultValue="保留草稿" />
        </div>
      </>
    );
  }
  render(<Fixture />);
  const trigger = screen.getByRole('button', { name: '任务筛选' });
  fireEvent.click(trigger);
  const input = screen.getByRole('textbox', { name: '筛选输入' });
  input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect((screen.getByRole('textbox', { name: '筛选输入' }) as HTMLInputElement).value).toBe(
    '保留草稿',
  );
});

it('disables consumer actions while busy', () => {
  const create = vi.fn();
  const search = vi.fn();
  render(
    <WorkspacePageChrome
      title="财务"
      createLabel="新建记账"
      create={{ onClick: create, disabled: true }}
      search={{ onClick: search, disabled: true }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '新建记账' }));
  fireEvent.click(screen.getByRole('button', { name: '财务搜索' }));
  expect(create).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();
});

it.each([false, true])(
  'owns display-menu Escape without disturbing a separately open filter: %s',
  (openFilter) => {
    function Fixture() {
      const [filterOpen, setFilterOpen] = useState(false);
      const id = useId();
      return (
        <>
          <WorkspacePageChrome
            title="任务"
            createLabel="新建任务"
            create={{ onClick() {} }}
            filter={{
              expanded: filterOpen,
              controls: id,
              onClick: () => setFilterOpen((value) => !value),
            }}
            display={
              <details onKeyDown={closeWorkspaceDisplayOnEscape}>
                <summary>任务显示设置</summary>
                <label>
                  <input type="checkbox" />
                  显示列
                </label>
              </details>
            }
          />
          <div id={id} hidden={!filterOpen}>
            <input aria-label="筛选草稿" defaultValue="保留" />
          </div>
        </>
      );
    }
    render(<Fixture />);
    const filter = screen.getByRole('button', { name: '任务筛选' });
    if (openFilter) fireEvent.click(filter);
    const summary = screen.getByText('任务显示设置');
    fireEvent.click(summary);
    if (openFilter) {
      fireEvent.keyDown(screen.getByRole('button', { name: '新建任务' }), { key: 'Escape' });
      expect(filter.getAttribute('aria-expanded')).toBe('true');
      expect(summary.parentElement?.hasAttribute('open')).toBe(true);
    }
    const option = screen.getByRole('checkbox', { name: '显示列' });
    option.focus();
    fireEvent.keyDown(option, { key: 'Escape' });
    expect(summary.parentElement?.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(filter.getAttribute('aria-expanded')).toBe(String(openFilter));
    if (openFilter)
      expect((screen.getByRole('textbox', { name: '筛选草稿' }) as HTMLInputElement).value).toBe(
        '保留',
      );
  },
);

it.each([{ isComposing: true }, { keyCode: 229 }, { isComposing: true, keyCode: 229 }])(
  'keeps the focused filter open while Escape cancels Chinese composition: %j',
  (composition) => {
    function Fixture() {
      const [open, setOpen] = useState(false);
      const id = useId();
      return (
        <>
          <WorkspacePageChrome
            title="任务"
            createLabel="新建任务"
            create={{ onClick() {} }}
            filter={{ expanded: open, controls: id, onClick: () => setOpen((value) => !value) }}
          />
          <div id={id} hidden={!open}>
            <input aria-label="合成中的筛选" defaultValue="保留输入" />
          </div>
        </>
      );
    }
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: '任务筛选' });
    fireEvent.click(trigger);
    const input = screen.getByRole('textbox', { name: '合成中的筛选' });
    input.focus();
    const composingEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
      ...composition,
    });
    fireEvent(input, composingEscape);
    expect(composingEscape.defaultPrevented).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe('保留输入');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  },
);
