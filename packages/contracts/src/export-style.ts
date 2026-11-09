import { z } from 'zod';

const runningText = z
  .string()
  .trim()
  .max(120)
  .refine((value) => !/[\p{Cc}]/u.test(value));

// 这里只表达可校验的样式值；字体文件身份与配置指纹由宿主冻结，不由 Renderer 指定。
export const exportStyleSchema = z
  .object({
    version: z.literal(1),
    paper: z.enum(['A4', 'Letter']),
    font: z.enum(['arial-unicode', 'pingfang']),
    font_size: z.number().min(10).max(24).multipleOf(0.5),
    margins: z
      .object({
        top: z.number().min(8).max(50),
        right: z.number().min(8).max(50),
        bottom: z.number().min(8).max(50),
        left: z.number().min(8).max(50),
      })
      .strict(),
    header: runningText,
    footer: runningText,
  })
  .strict()
  .refine((style) => !style.header || style.margins.top >= 12, {
    message: '页眉需要至少 12 毫米的上边距。',
    path: ['margins', 'top'],
  })
  .refine((style) => !style.footer || style.margins.bottom >= 12, {
    message: '页脚需要至少 12 毫米的下边距。',
    path: ['margins', 'bottom'],
  });

export type ExportStyle = z.infer<typeof exportStyleSchema>;
export const defaultExportStyle: ExportStyle = {
  version: 1,
  paper: 'A4',
  font: 'arial-unicode',
  font_size: 12,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  header: '',
  footer: '',
};
