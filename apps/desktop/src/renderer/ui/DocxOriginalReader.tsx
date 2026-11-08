import type { ReactNode } from 'react';
import type { Material } from '../../preload/caselite-api';

export function DocxOriginalReader({
  name,
  material,
  onClose,
  onSaveOriginal,
  selection,
  children,
}: {
  name: string;
  material?: Material;
  onClose(): void;
  onSaveOriginal(): void;
  selection?: { pages: number[]; disabled: boolean; toggle(page: number): void };
  children?: ReactNode;
}) {
  const review = material?.pages[0]?.docx_review;
  return (
    <section aria-label="Word 固定原件" className="material-docx-reader">
      <header className="material-reader-tools">
        <strong>{name}</strong>
        <button type="button" onClick={onSaveOriginal}>
          保存原件副本
        </button>
        <button type="button" onClick={onClose}>
          收起阅读
        </button>
      </header>
      <p>固定原件已校验 · 以下为提取正文</p>
      <small>SHA-256 {material?.sha256}</small>
      {(review?.revisions || review?.comments) && (
        <p role="status">
          原件含{review.revisions ? '修订' : ''}
          {review.revisions && review.comments ? '和' : ''}
          {review.comments ? '批注' : ''}。下方正文可能省略删除文字和审阅意见，请核对原件。
        </p>
      )}
      {material?.status === 'processing' && <p>正在本地提取文字…</p>}
      {material?.status === 'failed' && <p role="alert">提取未完成，仍可保存原件副本。</p>}
      {children}
      {material?.pages.map((page) => (
        <label key={page.page}>
          {selection && (
            <input
              type="checkbox"
              disabled={selection.disabled}
              checked={selection.pages.includes(page.page)}
              onChange={() => selection.toggle(page.page)}
            />
          )}
          <span>
            提取段 {page.page} · {page.text}
          </span>
        </label>
      ))}
    </section>
  );
}
