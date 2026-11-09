import type { ReviewAction, ReviewRange, ReviewSaved } from '@caselite/contracts';
import type { TaskPort } from './task-application';

/** 审阅读取仍由本地存储拥有；应用层只编排确认和原提交回执核对。 */
export interface DocumentReviewPort {
  reviewDocumentExists(documentId: string): boolean;
  reviewSaved(range: ReviewRange, receipt: string): ReviewSaved | undefined;
  reviewState(
    range: ReviewRange,
    replacement?: string,
    action?: ReviewAction,
  ): Uint8Array | undefined;
}
export function createDocumentReviewApplication(store: DocumentReviewPort, tasks: TaskPort) {
  return {
    exists: store.reviewDocumentExists,
    matches: (range: ReviewRange) => Boolean(store.reviewState(range)),
    receipt: (range: ReviewRange, key: string) => store.reviewSaved(range, key),
    apply(range: ReviewRange, replacement: string, key: string, action: ReviewAction = 'replace') {
      const prior = store.reviewSaved(range, key);
      if (prior) return prior;
      const state = store.reviewState(range, replacement, action);
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
