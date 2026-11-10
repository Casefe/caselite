import type { ContactEntry, ContactSourceRef } from '../../../preload/caselite-api';

const activityTitles: Record<string, string> = {
  create: '创建任务',
  update: '修改任务',
  change_status: '更新任务状态',
  save: '保存正文',
  update_attributes: '更新任务属性',
  create_snapshot: '固定交付版本',
  export_snapshot: '导出文档',
  reminder_schedule: '设置提醒',
  reminder_reschedule: '调整提醒',
  reminder_cancel: '取消提醒',
  assign_project: '调整项目归组',
};
export type ContactActivity = {
  id: string;
  title: string;
  content: string;
  date: string | null;
  label: string;
  entry?: ContactEntry;
  source?: ContactSourceRef;
  taskId?: string;
};
export async function readContactSources(refs: ContactSourceRef[], taskIds: string[], pages = 1) {
  const items: ContactActivity[] = [];
  let partial = false,
    more = false;
  const results = await Promise.allSettled([
    ...refs.map(async (source) => {
      if (source.kind === 'run') {
        const result = await window.caselite.agent({
          protocol_version: 1,
          operation: 'read',
          scope: source.scope,
        });
        const run = result.ok ? result.runs.find((row) => row.id === source.id) : undefined;
        if (!run) throw Error('对话暂不可读');
        return [
          {
            id: `run:${source.id}`,
            title: run.prompt,
            content: run.output || '尚无回复',
            date: run.created_at ?? null,
            label: '关联 AI 对话',
            source,
          },
        ];
      }
      if (source.kind === 'material') {
        const result = await window.caselite.material({
          protocol_version: 1,
          operation: 'list',
          scope: source.scope,
        });
        const file = result.ok ? result.materials.find((row) => row.id === source.id) : undefined;
        if (!file) throw Error('材料暂不可读');
        return [
          {
            id: `material:${file.id}`,
            title: file.name,
            content: '打开原任务查看材料；上传时间未记录。',
            date: null,
            label: '关联材料',
            source,
            taskId: file.task_id,
          },
        ];
      }
      const result = await window.caselite.finance({
        protocol_version: 1,
        operation: 'read',
        project_id: source.scope,
      });
      const payment =
        result.ok && result.kind === 'ledger'
          ? result.ledger?.payments.find((row) => row.id === source.id)
          : undefined;
      if (!payment) throw Error('账款暂不可读');
      return [
        {
          id: `payment:${payment.id}`,
          title: `${payment.reversed_at ? '已冲销 · ' : ''}收款 ¥${(payment.amount_cents / 100).toFixed(2)}`,
          content: payment.note ?? '',
          date: payment.occurred_on ?? payment.committed_at,
          label: payment.occurred_on ? '相关台账 · 收款日期' : '相关台账 · 登记时间',
          source,
        },
      ];
    }),
    ...taskIds.map(async (taskId) => {
      const list: ContactActivity[] = [];
      // 任务关系只证明活动相关；不据此推断提交人、付款人或参与人。
      const results = await Promise.allSettled([
        window.caselite.material({ protocol_version: 1, operation: 'list', scope: taskId }),
        ...Array.from({ length: pages }, (_, page) =>
          window.caselite.catalog({
            protocol_version: 1,
            operation: 'list_activity',
            scope: { type: 'task', id: taskId },
            offset: page * 20,
          }),
        ),
      ]);
      const material = results[0];
      if (material.status === 'fulfilled' && material.value.ok && 'materials' in material.value) {
        for (const file of material.value.materials)
          list.push({
            id: `material:${file.id}`,
            title: file.name,
            content: '打开原任务查看材料；上传时间未记录。',
            date: null,
            label: '关联任务材料',
            taskId,
          });
      } else partial = true;
      for (const result of results.slice(1)) {
        if (result.status !== 'fulfilled' || !result.value.ok || !('activity' in result.value)) {
          partial = true;
          continue;
        }
        const page = result.value;
        if (result === results.at(-1) && page.activity_has_more) more = true;
        for (const activity of page.activity ?? [])
          list.push({
            id: `activity:${activity.origin}:${activity.id}`,
            title: '关联任务活动',
            content: activityTitles[activity.operation] ?? '任务活动已更新',
            date: activity.committed_at,
            label: '任务活动 · 记录时间',
            taskId,
          });
      }
      return list;
    }),
  ]);
  for (const result of results) {
    if (result.status === 'fulfilled') items.push(...result.value);
    else partial = true;
  }
  return { items: [...new Map(items.map((item) => [item.id, item])).values()], partial, more };
}
export function contactTimeline(
  entries: ContactEntry[],
  sources: ContactActivity[],
): ContactActivity[] {
  const recordedRuns = new Set(entries.map((entry) => entry.source_run_id).filter(Boolean));
  return [
    ...entries.map(
      (entry) =>
        ({
          id: `entry:${entry.id}`,
          title: entry.title,
          content: entry.content,
          date: entry.occurred_on ?? entry.created_at,
          label: '',
          entry,
        }) satisfies ContactActivity,
    ),
    ...sources.filter(
      (source) => source.source?.kind !== 'run' || !recordedRuns.has(source.source.id),
    ),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id));
}
