import type { FolderResponse } from '@caselite/contracts';

const messages = {
  INVALID_REQUEST: '请求格式无效。',
  FORBIDDEN: '当前页面或范围无权执行此操作。',
  ROOT_EXPIRED: '文件夹状态已变化，请刷新后重试。',
  ROOT_MISMATCH: '所选文件夹与原目录不匹配，请重新选择原目录。',
  ENTRY_CHANGED: '文件或目录已变化，请刷新后重新打开。',
  DIRECTORY_LIMIT: '此目录直属项目超过本期上限256项，请选择更小的目录。',
  CURSOR_EXPIRED: '目录内容已变化，请刷新目录。',
  UNSUPPORTED_FORMAT: '此文件格式暂不支持预览。',
  FILE_LIMIT: '文件超过支持的大小或页数上限。',
  FILE_UNAVAILABLE: '无法打开此文件，请核对格式、权限或磁盘连接。',
  BUSY: '此文件还有未完成的打开请求，请先恢复或取消。',
  CANCELLED: '已取消打开。',
  CAPTURE_PENDING: '尚未确认保存结果，请保留原请求并核对。',
  RECEIPT_CONFLICT: '原请求与当前目标不一致，请核对原打开记录。',
  SOURCE_UNAVAILABLE: '此固定副本不在当前范围或暂不可用。',
  DATABASE_UNAVAILABLE: '本地记录暂不可用，已保留原件和请求。',
  REVISION_CONFLICT: '文件夹设置已更新，请重新读取后操作。',
  NOT_FOUND: '尚未找到该请求的记录。',
  RESULT_UNKNOWN: '未能确认结果，请使用原请求核对。',
} satisfies Record<Exclude<FolderResponse, { ok: true }>['code'], string>;

export function folderFailure(error: unknown): Exclude<FolderResponse, { ok: true }> {
  const value = error instanceof Error ? error.message : '';
  const translated: Record<string, keyof typeof messages> = {
    STALE_CALLER: 'FORBIDDEN',
    INVALID_GRANT: 'FORBIDDEN',
    CONFIGURATION_CHANGED: 'ROOT_EXPIRED',
    PROJECT_UNAVAILABLE: 'FORBIDDEN',
    IDENTITY_CHANGED: 'ROOT_MISMATCH',
    INVALID_DIRECTORY: 'ROOT_MISMATCH',
    DIGEST_CONFLICT: 'RECEIPT_CONFLICT',
  };
  const code =
    translated[value] ??
    (Object.hasOwn(messages, value) ? (value as keyof typeof messages) : 'FILE_UNAVAILABLE');
  return { ok: false, code, message: messages[code] };
}
