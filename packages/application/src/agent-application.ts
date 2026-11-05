import { agentRequestSchema, type AgentResponse, type AgentRun } from '@caselite/contracts';

export interface AgentCredentialPort {
  get(): string | undefined;
  set(key: string): void | Promise<void>;
  clear(): void;
}
export interface AgentRuntimePort {
  start(input: {
    prompt: string;
    key: string;
    onText(text: string): void;
    onEnd(result: {
      status: 'succeeded' | 'failed';
      usage: AgentRun['usage'];
      message: string;
    }): void;
  }): { cancel(): void };
}

// 此增量仅有本次进程内的运行投影；不冒充持久化会话，也不从UI历史拼接模型上下文。
export function createAgentApplication(ports: {
  credentials: AgentCredentialPort;
  runtime: AgentRuntimePort;
  taskExists(id: string): boolean;
}) {
  const runs = new Map<string, { owner: string; run: AgentRun; cancel?: () => void }>();
  let configuring = false;
  const failure = (code: string, message: string): AgentResponse => ({ ok: false, code, message });
  const configured = () => {
    try {
      return Boolean(ports.credentials.get());
    } catch {
      return false;
    }
  };
  return {
    async execute(input: unknown, owner: string): Promise<AgentResponse> {
      const parsed = agentRequestSchema.safeParse(input);
      if (!parsed.success) return failure('INVALID_REQUEST', '输入格式或发送确认无效。');
      const request = parsed.data;
      if (
        configuring &&
        (request.operation === 'configure' ||
          request.operation === 'clear_key' ||
          (request.operation === 'start' && !runs.has(request.run_id)))
      )
        return failure('BUSY', '模型配置正在保存，请稍后核对。');
      try {
        const active = [...runs.values()].find((item) => item.run.status === 'running');
        if (request.operation === 'configure' || request.operation === 'clear_key') {
          if (active) return failure('BUSY', '请先停止当前运行，再修改模型配置。');
          if (request.operation === 'configure') {
            configuring = true;
            try {
              await ports.credentials.set(request.key);
            } finally {
              configuring = false;
            }
          } else ports.credentials.clear();
        }
        if ('scope' in request && request.scope !== 'home' && !ports.taskExists(request.scope))
          return failure('NOT_FOUND', '任务不存在，未读取或发送任何正文。');
        if (request.operation === 'start') {
          const existing = runs.get(request.run_id);
          if (existing) {
            if (
              existing.owner !== owner ||
              existing.run.scope !== request.scope ||
              existing.run.prompt !== request.prompt
            )
              return failure('CONFLICT', '运行标识不匹配，未重复发送。');
          } else {
            if (active) return failure('BUSY', '已有运行进行中，请先停止或等待结束。');
            if (runs.size >= 100)
              return failure('LIMIT', '本次会话已达运行上限，请先保存需要保留的结果。');
            const key = ports.credentials.get();
            if (!key)
              return failure(
                'NO_KEY',
                '请先配置自己的 OpenAI API Key。不会使用其他软件的登录或额度。',
              );
            const run: AgentRun = {
              id: request.run_id,
              scope: request.scope,
              prompt: request.prompt,
              output: '',
              status: 'running',
              sequence: 0,
              message: '',
              usage: null,
            };
            const item: { owner: string; run: AgentRun; cancel?: () => void } = { owner, run };
            runs.set(run.id, item);
            try {
              const handle = ports.runtime.start({
                prompt: run.prompt,
                key,
                onText(text) {
                  if (run.status === 'running') {
                    run.output = text.slice(0, 64_000);
                    run.sequence++;
                  }
                },
                onEnd(result) {
                  if (run.status === 'running') {
                    Object.assign(run, result);
                    run.sequence++;
                    item.cancel = undefined;
                  }
                },
              });
              if (run.status === 'running') item.cancel = () => handle.cancel();
            } catch {
              run.status = 'failed';
              run.message = '模型启动失败，未自动重试。';
              run.sequence++;
            }
          }
        }
        if (request.operation === 'cancel') {
          const item = runs.get(request.run_id);
          if (!item || item.owner !== owner || item.run.scope !== request.scope)
            return failure('NOT_FOUND', '未找到当前范围的运行。');
          if (item.run.status === 'running') {
            item.run.status = 'cancelled';
            item.run.sequence++;
            item.run.message = '已停止本地生成；远端可能已处理或计费，用量尚不确定。';
            item.cancel?.();
            item.cancel = undefined;
          }
        }
        return {
          ok: true,
          configured: configured(),
          model: 'gpt-4.1-mini',
          runs:
            'scope' in request
              ? [...runs.values()]
                  .filter((item) => item.owner === owner && item.run.scope === request.scope)
                  .map((item) => ({ ...item.run }))
              : [],
        };
      } catch {
        return failure('UNAVAILABLE', '模型配置或运行暂不可用。未自动重试，也未修改正文。');
      }
    },
    release(owner?: string) {
      for (const item of runs.values())
        if ((!owner || item.owner === owner) && item.run.status === 'running') {
          item.run.status = 'cancelled';
          item.run.message = '窗口关闭，运行已停止。';
          item.run.sequence++;
          item.cancel?.();
          item.cancel = undefined;
        }
    },
  };
}
