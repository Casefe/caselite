import type { TaskCreationAttachmentController } from './useTaskCreationAttachments';
import { FileUploadButton, FileUploadList } from '../../shared/ui/FileUpload';

export function CreationUploadButton({
  controller,
  disabled,
}: {
  controller: TaskCreationAttachmentController;
  disabled: boolean;
}) {
  return (
    <FileUploadButton
      disabled={
        disabled ||
        controller.busy ||
        !controller.ready ||
        !controller.available ||
        controller.draft?.state === 'bound'
      }
      onPick={() => void controller.pick()}
      title={`${window.caselite.creationPolicy?.file_extensions.join(' / ').toUpperCase() ?? '本地附件'}${window.caselite.creationPolicy ? `，每份不超过 ${window.caselite.creationPolicy.max_file_bytes / 1024 / 1024} MB` : ''}`}
    />
  );
}
export function CreationAttachments({
  controller,
  disabled,
}: {
  controller: TaskCreationAttachmentController;
  disabled: boolean;
}) {
  return (
    <section className="creation-attachments" aria-label="创建附件">
      {controller.recovered && (
        <p role="status">
          已恢复上次未完成的附件，请核对后继续
          {controller.draft?.task_id ? '保存；原任务不会重复创建' : '创建'}。
        </p>
      )}
      <FileUploadList
        files={(controller.draft?.files ?? []).map((file) => ({
          id: file.token,
          name: file.name,
          bytes: file.bytes,
          status: file.saved ? '已保存' : controller.busy ? '处理中…' : '待保存',
        }))}
        note="创建时保存"
        disabled={disabled || controller.busy || controller.draft?.state !== 'open'}
        onRemove={(id) => void controller.remove(id)}
      />
      {controller.error && (
        <p role="alert">
          {controller.error}
          {!controller.ready && (
            <button
              type="button"
              disabled={controller.busy}
              onClick={() => void controller.resume()}
            >
              重读未完成附件
            </button>
          )}
        </p>
      )}
      {controller.busy && <p role="status">正在核对附件…</p>}
    </section>
  );
}
