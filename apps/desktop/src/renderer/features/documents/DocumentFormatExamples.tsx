import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DraftEditor, type RichDraft } from '../../editors/RichEditor';

const PdfReader = lazy(() => import('../../ui/PdfReader'));
export const formatExamples = [
  { id: 'example:word', title: '战略合作协议（合成）.docx', format: 'Word' },
  { id: 'example:pdf', title: '合同原件（合成）.pdf', format: 'PDF' },
] as const;
export type FormatExample = (typeof formatExamples)[number];

export default function DocumentFormatExample({
  example,
  onClose,
}: {
  example: FormatExample;
  onClose(): void;
}) {
  const [value, setValue] = useState<RichDraft>({
    text: '战略合作协议\n甲方：合成示例甲公司\n乙方：合成示例乙公司\n一、合作目的\n本文件为合成Word语义编辑示例。可在此直接修改文字，检查格式与双栏操作。\n二、工作安排\n双方依次整理资料、审阅工作稿并核对交付版本。\n三、资料保全\n真实文档通过保存正文写入本机；此示例仅在当前打开期间保留修改。',
    state: null,
  });
  const pdf = useQuery({
    queryKey: ['document-example-pdf'],
    enabled: example.format === 'PDF',
    staleTime: Infinity,
    queryFn: async () => {
      // 仅加载已存在的公开合成夹具；URL由打包器固定，不接收本机路径或外部地址。
      const url = new URL(
        '../../../../../../tests/fixtures/case-materials/development/contract-v1-text.pdf',
        import.meta.url,
      );
      // asset/inline生成固定data URL；直接解码，遵守connect-src self，不放宽CSP。
      if (!url.href.startsWith('data:application/pdf;base64,'))
        throw new Error('合成PDF暂不可读取。');
      return Uint8Array.from(atob(url.href.slice(url.href.indexOf(',') + 1)), (c) =>
        c.charCodeAt(0),
      );
    },
  });
  if (example.format === 'PDF')
    return (
      <div className="document-format-example">
        <p className="document-readonly-note">合成PDF示例 · PDF.js真实读取 · 原件只读</p>
        {pdf.error ? (
          <p role="alert">{pdf.error.message}</p>
        ) : pdf.data ? (
          <Suspense fallback={<p>正在加载PDF…</p>}>
            <PdfReader bytes={pdf.data} name={example.title} onClose={onClose} initialWidth={480} />
          </Suspense>
        ) : (
          <p role="status">正在读取合成PDF…</p>
        )}
      </div>
    );
  return (
    <div className="document-format-example">
      <p className="document-readonly-note">合成Word语义示例 · 可直接修改 · 仅本次打开期间保留</p>
      <DraftEditor value={value} onChange={setValue} label="Word示例正文" profile="document" />
      <p className="caption">这是语义稿编辑模拟，不代表原Word分页、图片和修订的无损往返。</p>
    </div>
  );
}
