import type { ThreadMessageLike } from '@assistant-ui/react';
import type { AgentRun } from '../../../preload/caselite-api';

// UI 投影只映射已有 Run，不创建会话或保存第二份运行历史。
export function agentMessages(runs: AgentRun[]): ThreadMessageLike[] {
  return runs.flatMap((run) => [
    {
      id: `${run.id}:input`,
      role: 'user' as const,
      content: [{ type: 'text' as const, text: run.prompt }],
      metadata: { custom: { attachments: run.attachments } },
    },
    {
      id: `${run.id}:output`,
      role: 'assistant' as const,
      metadata: {
        custom: {
          run: {
            id: run.id,
            scope: run.scope,
            model: run.model,
            status: run.status,
            message: run.message,
            copyable: Boolean(run.output),
          },
        },
      },
      content: [
        {
          type: 'text' as const,
          text: run.output || (run.status === 'running' ? '正在等待模型…' : run.message),
        },
      ],
      status:
        run.status === 'running'
          ? { type: 'running' as const }
          : run.status === 'succeeded'
            ? { type: 'complete' as const, reason: 'stop' as const }
            : {
                type: 'incomplete' as const,
                reason: run.status === 'cancelled' ? ('cancelled' as const) : ('error' as const),
              },
    },
  ]);
}
