import { createDocumentReviewApplication, type createTaskApplication } from '@caselite/application';
import type { openTaskStore } from '@caselite/local-db';

// 宿主仅组合已有端口，保存仍经过任务应用的校验和同一存储事务。
export function documentReviewStore(
  store: ReturnType<typeof openTaskStore>,
  tasks: ReturnType<typeof createTaskApplication>,
) {
  return createDocumentReviewApplication(store, tasks);
}
