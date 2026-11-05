import {
  agentRequestSchema,
  agentProviderFor,
  type AgentModel,
  type AgentProvider,
  type AgentResponse,
  type AgentRun,
} from '@caselite/contracts';

export interface AgentCredentialPort {
  get(provider?: AgentProvider): string | undefined;
  set(key: string, provider?: AgentProvider): void | Promise<void>;
  clear(provider?: AgentProvider): void;
  getDefaultModel(): AgentModel;
  setDefaultModel(model: AgentModel): void | Promise<void>;
}
export interface AgentRuntimePort {
  start(input: {
    model: AgentModel;
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
  const configured = (provider: AgentProvider) => {
    try {
      return Boolean(ports.credentials.get(provider));
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
          request.operation === 'select_model' ||
          (request.operation === 'start' && !runs.has(request.run_id)))
      )
        return failure('BUSY', '模型配置正在保存，请稍后核对。');
      try {
        const active = [...runs.values()].find((item) => item.run.status === 'running');
        if (
          request.operation === 'configure' ||
          request.operation === 'clear_key' ||
          request.operation === 'select_model'
        ) {
          if (active) return failure('BUSY', '请先停止当前运行，再修改模型配置。');
          if (request.operation !== 'clear_key') {
            configuring = true;
            try {
              if (request.operation === 'configure')
                await ports.credentials.set(request.key, request.provider ?? 'openai');
              else {
                if (!ports.credentials.get(agentProviderFor(request.model)))
                  return failure('NO_KEY', '请先保存该服务商的 Key，再设为默认模型。');
                await ports.credentials.setDefaultModel(request.model);
              }
            } finally {
              configuring = false;
            }
          } else ports.credentials.clear(request.provider ?? 'openai');
        }
        if ('scope' in request && request.scope !== 'home' && !ports.taskExists(request.scope))
          return failure('NOT_FOUND', '任务不存在，未读取或发送任何正文。');
        if (request.operation === 'start') {
          const selectedModel = request.model ?? 'gpt-4.1-mini';
          const provider = agentProviderFor(selectedModel);
          const existing = runs.get(request.run_id);
          if (existing) {
            if (
              existing.owner !== owner ||
              existing.run.scope !== request.scope ||
              existing.run.prompt !== request.prompt ||
              existing.run.model !== selectedModel
            )
              return failure('CONFLICT', '运行标识不匹配，未重复发送。');
          } else {
            if (active) return failure('BUSY', '已有运行进行中，请先停止或等待结束。');
            if (runs.size >= 100)
              return failure('LIMIT', '本次会话已达运行上限，请先保存需要保留的结果。');
            if (ports.credentials.getDefaultModel() !== selectedModel)
              return failure('MODEL_CHANGED', '默认模型已变化，请返回修改并重新预览；本次未发送。');
            const key = ports.credentials.get(provider);
            if (!key)
              return failure(
                'NO_KEY',
                '请先配置所选服务商的 API Key。不会使用其他软件的登录或额度。',
              );
            const run: AgentRun = {
              provider,
              model: selectedModel,
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
                model: selectedModel,
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
        // 已接受运行的回执不受默认配置读取失败影响；不再派发任何请求。
        const model =
          request.operation === 'start'
            ? (request.model ?? 'gpt-4.1-mini')
            : ports.credentials.getDefaultModel();
        const providers = { openai: configured('openai'), deepseek: configured('deepseek') };
        return {
          ok: true,
          configured: providers[agentProviderFor(model)],
          model,
          providers,
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
