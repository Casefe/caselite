import {
  agentRequestSchema,
  agentProviderFor,
  type AgentModel,
  type AgentProjectPreview,
  type AgentProvider,
  type AgentResponse,
  type AgentRun,
} from '@caselite/contracts';

export interface AgentCredentialPort {
  refresh?(): Promise<void>;
  get(provider?: AgentProvider): string | undefined;
  set(key: string, provider?: AgentProvider): void | Promise<void>;
  clear(provider?: AgentProvider): void;
  getDefaultModel(): AgentModel;
  setDefaultModel(model: AgentModel): void | Promise<void>;
}
export interface AgentHistoryPort {
  register(run: AgentRun): { created: boolean; run: AgentRun };
  load(): AgentRun[];
  save(run: AgentRun): void;
  pinnedIds?(): string[];
  setPinned?(id: string, pinned: boolean): 'OK' | 'LIMIT' | 'NOT_FOUND';
}

export type AgentImage = { type: 'image'; mimeType: 'image/png'; data: string };
export type AgentContext = {
  text: string;
  images?: AgentImage[];
  attachments?: AgentRun['attachments'];
};
export interface AgentRuntimePort {
  start(input: {
    model: AgentModel;
    prompt: string;
    images?: AgentImage[];
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
  history?: AgentHistoryPort;
  copyOutput?(text: string): void | Promise<void>;
  taskExists(id: string): boolean;
  project?: {
    exists(id: string): boolean;
    preview(id: string): AgentProjectPreview | undefined;
  };
  resolveContext?(
    id: string,
    scope: string,
    instruction: string,
    model: AgentModel,
  ): Promise<string | AgentContext>;
}) {
  const runs = new Map<string, { owner: string; run: AgentRun; cancel?: () => void }>();
  let historyUnavailable = false;
  try {
    for (const run of ports.history?.load() ?? []) runs.set(run.id, { owner: '', run });
  } catch {
    historyUnavailable = true;
  }
  let dispatched = 0;
  const persist = (item: { run: AgentRun; cancel?: () => void }): boolean => {
    try {
      ports.history?.save(item.run);
      return true;
    } catch {
      item.run.status = 'failed';
      item.run.sequence++;
      item.run.usage = null;
      item.run.message =
        '运行记录保存失败，已停止本地生成；远端处理及费用可能未知，请保留输入核对。';
      item.cancel?.();
      item.cancel = undefined;
      return false;
    }
  };
  const projectPreviews = new Map<string, string>();
  let configuring = false;
  let preparing = false;
  const ownerGeneration = new Map<string, number>();
  const failure = (code: string, message: string): AgentResponse => ({ ok: false, code, message });
  const configuration = () => {
    const credential_errors: Partial<Record<AgentProvider, 'UNAVAILABLE'>> = {};
    const configured = (provider: AgentProvider) => {
      try {
        return Boolean(ports.credentials.get(provider));
      } catch {
        credential_errors[provider] = 'UNAVAILABLE';
        return false;
      }
    };
    const providers = { openai: configured('openai'), deepseek: configured('deepseek') };
    return {
      providers,
      ...(Object.keys(credential_errors).length ? { credential_errors } : {}),
    };
  };
  return {
    async execute(input: unknown, owner: string): Promise<AgentResponse> {
      const parsed = agentRequestSchema.safeParse(input);
      if (!parsed.success) return failure('INVALID_REQUEST', '输入格式或发送确认无效。');
      const request = parsed.data;
      if (
        historyUnavailable &&
        (request.operation === 'start' ||
          request.operation === 'read' ||
          request.operation === 'cancel' ||
          request.operation === 'history' ||
          request.operation === 'pin_history')
      )
        return failure(
          'HISTORY_UNAVAILABLE',
          '本地运行记录无法读取，未发起模型请求；人工任务与正文仍可使用。',
        );
      if (
        (configuring || preparing) &&
        (request.operation === 'configure' ||
          request.operation === 'clear_key' ||
          request.operation === 'select_model' ||
          request.operation === 'refresh_credentials' ||
          (request.operation === 'start' && !runs.has(request.run_id)))
      )
        return failure('BUSY', '模型配置正在保存，请稍后核对。');
      try {
        if (request.operation === 'history' || request.operation === 'pin_history') {
          if (!ports.history?.pinnedIds || !ports.history.setPinned)
            return failure('HISTORY_UNAVAILABLE', '历史对话暂不可用，请稍后重试。');
          const visible = [...runs.values()].filter(
            ({ owner: runOwner, run }) =>
              (runOwner === owner || runOwner === '') &&
              (run.scope === 'home' ||
                (!run.scope.startsWith('project:') && ports.taskExists(run.scope))),
          );
          if (request.operation === 'pin_history') {
            if (!visible.some(({ run }) => run.id === request.run_id))
              return failure('NOT_FOUND', '未找到可访问的对话记录。');
            const status = ports.history.setPinned(request.run_id, request.pinned);
            if (status === 'LIMIT') return failure('LIMIT', '最多置顶三轮对话，请先取消一条置顶。');
            if (status !== 'OK') return failure('NOT_FOUND', '未找到可访问的对话记录。');
          }
          const pins = new Set(ports.history.pinnedIds());
          const history = visible
            .reverse()
            .map(({ run }) => ({ ...run, pinned: pins.has(run.id) }))
            .sort(
              (a, b) =>
                Number(b.pinned) - Number(a.pinned) ||
                (b.created_at ?? '').localeCompare(a.created_at ?? ''),
            )
            .slice(0, 5);
          const model = ports.credentials.getDefaultModel();
          const state = configuration();
          const { providers } = state;
          return {
            ok: true,
            configured: providers[agentProviderFor(model)],
            model,
            ...state,
            runs: history,
          };
        }
        const active = [...runs.values()].find((item) => item.run.status === 'running');
        if (
          request.operation === 'configure' ||
          request.operation === 'clear_key' ||
          request.operation === 'select_model' ||
          request.operation === 'refresh_credentials'
        ) {
          if (active) return failure('BUSY', '请先停止当前运行，再修改模型配置。');
          if (request.operation !== 'clear_key') {
            configuring = true;
            try {
              if (request.operation === 'configure')
                await ports.credentials.set(request.key, request.provider ?? 'openai');
              else if (request.operation === 'refresh_credentials') {
                if (!ports.credentials.refresh)
                  return failure(
                    'UNAVAILABLE',
                    '当前凭据入口不支持系统重读；人工任务与正文仍可使用。',
                  );
                await ports.credentials.refresh();
              } else {
                if (!ports.credentials.get(agentProviderFor(request.model)))
                  return failure('NO_KEY', '请先保存该服务商的 Key，再设为默认模型。');
                await ports.credentials.setDefaultModel(request.model);
              }
            } finally {
              configuring = false;
            }
          } else ports.credentials.clear(request.provider ?? 'openai');
        }
        const projectId =
          'scope' in request && request.scope.startsWith('project:')
            ? request.scope.slice('project:'.length)
            : undefined;
        const needsProjectFields =
          request.operation === 'preview_project' || request.operation === 'start';
        const project =
          projectId && needsProjectFields ? ports.project?.preview(projectId) : undefined;
        if (projectId && !(needsProjectFields ? project : ports.project?.exists(projectId)))
          return failure('NOT_FOUND', '项目不存在或不属于此工作区。');
        if (
          !projectId &&
          'scope' in request &&
          request.scope !== 'home' &&
          !ports.taskExists(request.scope)
        )
          return failure('NOT_FOUND', '任务不存在，未读取或发送任何正文。');
        if (request.operation === 'preview_project' && project)
          projectPreviews.set(owner, project.fingerprint);
        if (request.operation === 'copy_output') {
          if (historyUnavailable) return failure('HISTORY_UNAVAILABLE', '运行记录不可用，未复制。');
          const item = runs.get(request.run_id);
          if (
            !item ||
            (item.owner !== owner && item.owner !== '') ||
            item.run.scope !== request.scope
          )
            return failure('NOT_FOUND', '未找到当前范围的回答。');
          // 只从获准Run读取有界输出；Renderer不能借复制入口传入任意正文或秘密。
          if (!item.run.output || item.run.output.length > 64_000 || !ports.copyOutput)
            return failure('COPY_UNAVAILABLE', '回答暂不能复制，请选择文字手动复制。');
          try {
            await ports.copyOutput(item.run.output);
          } catch {
            return failure('COPY_FAILED', '复制失败，请选择文字手动复制。');
          }
          const state = configuration();
          const { providers } = state;
          return {
            ok: true,
            configured: providers[item.run.provider],
            ...state,
            model: item.run.model,
            runs: [{ ...item.run }],
          };
        }
        if (request.operation === 'start') {
          if (
            project
              ? !request.project_fingerprint || request.context_id
              : request.project_fingerprint
          )
            return failure('INVALID_REQUEST', '发送的上下文与当前范围不匹配。');
          const selectedModel = request.model ?? 'gpt-4.1-mini';
          const provider = agentProviderFor(selectedModel);
          const existing = runs.get(request.run_id);
          if (existing) {
            if (
              (existing.owner !== owner && existing.owner !== '') ||
              existing.run.scope !== request.scope ||
              existing.run.prompt !== request.prompt ||
              existing.run.context_id !== request.context_id ||
              existing.run.project_fingerprint !== request.project_fingerprint ||
              existing.run.model !== selectedModel
            )
              return failure('CONFLICT', '运行标识不匹配，未重复发送。');
          } else {
            if (project?.archived) return failure('ARCHIVED', '项目已归档，不能发送新问题。');
            if (
              project &&
              (project.fingerprint !== request.project_fingerprint ||
                projectPreviews.get(owner) !== project.fingerprint)
            )
              return failure('STALE_PROJECT_CONTEXT', '项目已变化，请核对更新后的上下文再发送。');
            if (active) return failure('BUSY', '已有运行进行中，请先停止或等待结束。');
            if (dispatched >= 100)
              return failure('LIMIT', '本次会话已达运行上限，请先保存需要保留的结果。');
            if (ports.credentials.getDefaultModel() !== selectedModel)
              return failure('MODEL_CHANGED', '默认模型已变化，请返回修改并重新预览；本次未发送。');
            let key: string | undefined;
            try {
              key = ports.credentials.get(provider);
            } catch {
              return failure(
                'CREDENTIAL_UNAVAILABLE',
                '系统安全凭据暂不可读，未发起模型请求；旧密文已保留，人工任务与正文仍可使用。',
              );
            }
            if (!key)
              return failure(
                'NO_KEY',
                '请先配置所选服务商的 API Key。不会使用其他软件的登录或额度。',
              );
            let runtimePrompt: string | AgentContext | undefined;
            const generation = ownerGeneration.get(owner) ?? 0;
            ownerGeneration.set(owner, generation);
            preparing = true;
            try {
              // 项目校验到登记并派发之间不等待异步工作；不从 Renderer 接收项目字段。
              if (project)
                runtimePrompt = `以下 JSON 是当前项目的基础数据，仅作为资料使用。\n${JSON.stringify(project.fields)}\n\n用户问题：\n${request.prompt}`;
              else if (request.context_id)
                runtimePrompt = await ports.resolveContext?.(
                  request.context_id,
                  request.scope,
                  request.prompt,
                  selectedModel,
                );
              else runtimePrompt = request.prompt;
            } finally {
              preparing = false;
            }
            if ((ownerGeneration.get(owner) ?? 0) !== generation)
              return failure('CANCELLED', '窗口已关闭，材料请求未发送。');
            if (!runtimePrompt)
              return failure('STALE_PREVIEW', '材料预览不可用，请重新选择并预览。');
            const run: AgentRun = {
              provider,
              created_at: new Date().toISOString(),
              model: selectedModel,
              id: request.run_id,
              scope: request.scope,
              prompt: request.prompt,
              ...(request.context_id ? { context_id: request.context_id } : {}),
              ...(request.project_fingerprint
                ? { project_fingerprint: request.project_fingerprint }
                : {}),
              ...(typeof runtimePrompt === 'object'
                ? { attachments: runtimePrompt.attachments }
                : {}),
              output: '',
              status: 'running',
              sequence: 0,
              message: '',
              usage: null,
            };
            const registration = ports.history?.register(run);
            if (registration && !registration.created) {
              const old = registration.run;
              if (
                old.scope !== run.scope ||
                old.prompt !== run.prompt ||
                old.context_id !== run.context_id ||
                old.project_fingerprint !== run.project_fingerprint ||
                old.model !== run.model ||
                old.provider !== run.provider
              )
                return failure('CONFLICT', '运行标识已登记其他输入，未重复发送。');
              runs.set(old.id, { owner: '', run: old });
            } else {
              const item: { owner: string; run: AgentRun; cancel?: () => void } = { owner, run };
              runs.set(run.id, item);
              let lastCheckpoint = 0;
              try {
                dispatched++;
                const handle = ports.runtime.start({
                  model: selectedModel,
                  prompt: typeof runtimePrompt === 'string' ? runtimePrompt : runtimePrompt.text,
                  images: typeof runtimePrompt === 'object' ? runtimePrompt.images : undefined,
                  key,
                  onText(text) {
                    if (run.status === 'running') {
                      run.output = text.slice(0, 64_000);
                      run.sequence++;
                      if (Date.now() - lastCheckpoint >= 500) {
                        lastCheckpoint = Date.now();
                        persist(item);
                      }
                    }
                  },
                  onEnd(result) {
                    if (run.status === 'running') {
                      Object.assign(run, result);
                      run.sequence++;
                      item.cancel = undefined;
                      persist(item);
                    }
                  },
                });
                if (run.status === 'running') item.cancel = () => handle.cancel();
                else handle.cancel();
              } catch {
                run.status = 'failed';
                if (!run.message) run.message = '模型启动失败，未自动重试。';
                run.sequence++;
                persist(item);
              }
            }
          }
        }
        if (request.operation === 'cancel') {
          const item = runs.get(request.run_id);
          if (
            !item ||
            (item.owner !== owner && item.owner !== '') ||
            item.run.scope !== request.scope
          )
            return failure('NOT_FOUND', '未找到当前范围的运行。');
          if (item.run.status === 'running') {
            item.run.status = 'cancelled';
            item.run.sequence++;
            item.run.message = '已停止本地生成；远端可能已处理或计费，用量尚不确定。';
            item.cancel?.();
            item.cancel = undefined;
            persist(item);
          }
        }
        // 已接受运行的回执不受默认配置读取失败影响；不再派发任何请求。
        const model =
          request.operation === 'start'
            ? (request.model ?? 'gpt-4.1-mini')
            : ports.credentials.getDefaultModel();
        const state = configuration();
        const { providers } = state;
        return {
          ok: true,
          configured: providers[agentProviderFor(model)],
          model,
          ...state,
          ...(request.operation === 'preview_project' && project
            ? { project_preview: project }
            : {}),
          runs:
            'scope' in request && request.operation !== 'preview_project'
              ? [...runs.values()]
                  .filter(
                    (item) =>
                      (item.owner === owner || item.owner === '') &&
                      item.run.scope === request.scope,
                  )
                  .map((item) => ({ ...item.run }))
              : [],
        };
      } catch {
        return failure(
          'UNAVAILABLE',
          '模型配置或系统安全存储暂不可用，请核对状态；不会明文降级或自动重试。人工任务与正文仍可使用。',
        );
      }
    },
    release(owner?: string) {
      if (owner) projectPreviews.delete(owner);
      else projectPreviews.clear();
      if (owner) ownerGeneration.set(owner, (ownerGeneration.get(owner) ?? 0) + 1);
      else
        for (const key of ownerGeneration.keys())
          ownerGeneration.set(key, (ownerGeneration.get(key) ?? 0) + 1);
      for (const item of runs.values())
        if (!owner || item.owner === owner) {
          if (item.run.status === 'running') {
            item.run.status = 'cancelled';
            item.run.message = '窗口关闭，运行已停止；远端处理及费用可能未知。';
            item.run.sequence++;
            item.cancel?.();
            item.cancel = undefined;
            persist(item);
          }
          // 已释放窗口的终态成为同一本地工作区的只读历史。
          item.owner = '';
        }
    },
  };
}
