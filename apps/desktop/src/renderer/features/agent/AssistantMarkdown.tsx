import {
  MarkdownTextPrimitive,
  type CodeHeaderProps,
  type MarkdownTextPrimitiveProps,
} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';

const remarkPlugins = [remarkGfm];

function CodeHeader({ language }: CodeHeaderProps) {
  return <div className="assistant-code-heading">{language || '纯文本'}</div>;
}

// 稳定的组件引用避免流式更新重建表格和代码块；模型内容不获得导航或联网能力。
const components: MarkdownTextPrimitiveProps['components'] = {
  a: ({ children }) => <span title="模型提供的链接，未经核验">{children}</span>,
  img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : '[模型图片未加载]'}</span>,
  table: ({ children }) => (
    <div className="assistant-table-scroll" role="region" aria-label="回答中的表格" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  CodeHeader,
};

export function AssistantMarkdown() {
  return (
    <MarkdownTextPrimitive
      className="assistant-markdown"
      skipHtml
      defer
      remarkPlugins={remarkPlugins}
      components={components}
    />
  );
}
