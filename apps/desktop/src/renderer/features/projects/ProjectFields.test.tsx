// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProjectFields, { projectValues, validProject } from './ProjectFields';
afterEach(cleanup);
it('preserves manual values on type changes and rejects bad date input until an input event repairs or clears it', () => {
  const submit = vi.fn();
  function Form() {
    const [value, setValue] = useState(() => {
      const initial = projectValues();
      return {
        ...initial,
        title: '合成',
        attributes: { ...initial.attributes, start_date: '2024-03-02', target_date: '2024-03-03' },
      };
    });
    const [invalid, setInvalid] = useState(false);
    return (
      <>
        <ProjectFields value={value} disabled={false} onChange={setValue} onInvalid={setInvalid} />
        <button disabled={invalid || !validProject(value)} onClick={() => submit(value)}>
          保存
        </button>
      </>
    );
  }
  render(<Form />);
  fireEvent.change(screen.getByLabelText('项目负责人'), { target: { value: '负责人' } });
  fireEvent.change(screen.getByLabelText('项目类型'), { target: { value: 'civil_litigation' } });
  expect((screen.getByLabelText('项目负责人') as HTMLInputElement).value).toBe('负责人');
  expect(screen.queryByLabelText('项目开始日')).toBeNull();
  const target = screen.getByLabelText('项目目标日') as HTMLInputElement;
  fireEvent.change(target, { target: { value: '2024-03-01' } });
  expect((screen.getByText('保存') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('请选择 2024-03-02 或之后的日期');
  fireEvent.change(target, { target: { value: '2024-03-03' } });
  expect((screen.getByText('保存') as HTMLButtonElement).disabled).toBe(false);
  const validity = vi
    .spyOn(target, 'validity', 'get')
    .mockReturnValue({ valid: false, badInput: true } as ValidityState);
  fireEvent.change(target, { target: { value: '' } });
  expect((screen.getByText('保存') as HTMLButtonElement).disabled).toBe(true);
  validity.mockRestore();
  fireEvent.input(target, { target: { value: '2024-03-03' } });
  expect((screen.getByText('保存') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(target, { target: { value: '' } });
  fireEvent.click(screen.getByText('保存'));
  expect(submit).toHaveBeenLastCalledWith(
    expect.objectContaining({
      attributes: expect.objectContaining({ start_date: '2024-03-02', target_date: null }),
    }),
  );
});
