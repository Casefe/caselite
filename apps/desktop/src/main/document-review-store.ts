import type { createTaskApplication } from '@caselite/application';
import type { ReviewRange } from '@caselite/contracts';
import type { openTaskStore } from '@caselite/local-db';

export function documentReviewStore(
  store: ReturnType<typeof openTaskStore>,
  tasks: ReturnType<typeof createTaskApplication>,
) {
  return {
    exists: store.reviewDocumentExists,
    matches: (range: ReviewRange) => Boolean(store.reviewState(range)),
    receipt: (range: ReviewRange, key: string) => store.reviewSaved(range, key),
    apply(range: ReviewRange, replacement: string, key: string) {
      const prior = store.reviewSaved(range, key);
      if (prior) return prior;
      const state = store.reviewState(range, replacement);
      if (!state) return { code: 'STALE_PREVIEW', message: '正文或选区已变化，未写回。' };
      const saved = tasks.execute({
        protocol_version: 1,
        operation: 'save',
        request_id: key,
        idempotency_key: key,
        task_id: range.task_id,
        document_id: range.document_id,
        body_id: range.body_id,
        expected_revision: range.revision,
        editor_schema: 1,
        state: Array.from(state),
      });
      if (!saved.ok) return saved;
      return (
        store.reviewSaved(range, key) ?? {
          code: 'RESULT_UNKNOWN',
          message: '保存结果待核对，请重试确认以核对原提交。',
        }
      );
    },
  };
}
