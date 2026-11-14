// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FileUploadButton, FileUploadList } from './FileUpload';

afterEach(cleanup);

it('uses caller supplied states, constraints and actions for independent upload consumers', () => {
  const firstPick = vi.fn();
  const secondPick = vi.fn();
  const firstRemove = vi.fn();
  const secondRemove = vi.fn();
  const { rerender } = render(
    <>
      <section aria-label="第一上传适配">
        <FileUploadButton title="PDF，限制由第一适配提供" onPick={firstPick} />
        <FileUploadList
          files={[{ id: 'first', name: '资料.pdf', bytes: 1024, status: '待保存' }]}
          onRemove={firstRemove}
          note="创建时保存"
        />
      </section>
      <section aria-label="第二上传适配">
        <FileUploadButton disabled title="图片，限制由第二适配提供" onPick={secondPick} />
        <FileUploadList
          files={[{ id: 'second', name: '图片.png', bytes: 2048, status: '已保存' }]}
          disabled
          onRemove={secondRemove}
        />
      </section>
    </>,
  );
  const first = within(screen.getByRole('region', { name: '第一上传适配' }));
  const second = within(screen.getByRole('region', { name: '第二上传适配' }));
  fireEvent.click(first.getByRole('button', { name: '上传文件' }));
  fireEvent.click(first.getByRole('button', { name: '移除附件 资料.pdf' }));
  fireEvent.click(second.getByRole('button', { name: '上传文件' }));
  fireEvent.click(second.getByRole('button', { name: '移除附件 图片.png' }));
  expect(firstPick).toHaveBeenCalledOnce();
  expect(firstRemove).toHaveBeenCalledExactlyOnceWith('first');
  expect(secondPick).not.toHaveBeenCalled();
  expect(secondRemove).not.toHaveBeenCalled();
  expect(first.getByText('待保存')).toBeTruthy();
  expect(second.getByText('已保存')).toBeTruthy();
  expect(first.getByTitle('PDF，限制由第一适配提供')).toBeTruthy();
  expect(second.getByTitle('图片，限制由第二适配提供')).toBeTruthy();
  rerender(<FileUploadList files={[]} onRemove={firstRemove} />);
  expect(screen.queryByRole('list')).toBeNull();
});
