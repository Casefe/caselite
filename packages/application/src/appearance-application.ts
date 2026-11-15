import {
  appearanceRequestSchema,
  appearanceValuesSchema,
  themeProposalSchema,
  type AppearanceResponse,
  type AppearanceValues,
  type SkinId,
  type Theme,
  type ThemeCommand,
} from '@caselite/contracts';

export type AppearancePort = {
  read(): Theme;
  write(theme: Theme): void;
  // 兼容原theme-only消费者；真实桌面适配器用一次读取提供完整快照。
  readAppearance?(): AppearanceValues;
  writeSkin?(skin: SkinId | undefined): void;
};

export function createAppearanceApplication(port: AppearancePort) {
  let revision = 0;
  const commands = new Map<string, { owner: string; revision: number; result: ThemeCommand }>();
  const failed = (message: string): AppearanceResponse => ({ ok: false, message });
  const invalidateExternalChange = (current: string) => {
    if (observed !== undefined && current !== observed) revision++;
    observed = current;
  };
  let observed: string | undefined;
  const readAppearance = () => {
    const value = appearanceValuesSchema.parse(port.readAppearance?.() ?? { theme: port.read() });
    invalidateExternalChange(`${value.theme}:${value.skin ?? ''}`);
    return value;
  };
  const read = () => readAppearance().theme;
  const view = (id: string, owner: string): AppearanceResponse => {
    const item = commands.get(id);
    if (!item || item.owner !== owner)
      return failed('操作已过期或不属于当前窗口，请核对当前主题。');
    try {
      const appearance = readAppearance();
      const theme = appearance.theme;
      const expected =
        item.result.state === 'undone' || item.result.state === 'pending'
          ? item.result.before
          : item.result.after;
      item.result.current = item.revision === revision && theme === expected;
      item.result.can_undo = item.result.state === 'saved' && item.result.current;
      return { ok: true, ...appearance, command: { ...item.result } };
    } catch {
      return failed('无法读取本机主题，结果待核对；未重复提交。');
    }
  };
  const application = {
    execute(input: unknown): AppearanceResponse {
      const parsed = appearanceRequestSchema.safeParse(input);
      if (!parsed.success) return { ok: false, message: '主题请求无效。' };
      const request = parsed.data;
      try {
        if (request.operation === 'set') {
          // 所有手动和对话写入共享此修订；失败和ABA也不能保留旧撤销授权。
          revision++;
          port.write(request.theme);
        }
        if (request.operation === 'set_skin' || request.operation === 'reset_skin') {
          if (!port.readAppearance || !port.writeSkin)
            return failed('此版本未接通皮肤保存，请更新后重试。');
          // 外观手动写入共享同一修订，皮肤改变也使旧AI授权与撤销失效。
          revision++;
          port.writeSkin(request.operation === 'set_skin' ? request.skin : undefined);
        }
        const appearance = readAppearance();
        if (
          request.operation === 'applied' &&
          (request.theme !== appearance.theme || (request.skin ?? undefined) !== appearance.skin)
        )
          return { ok: false, message: '外观已发生变化，请重新读取后同步。' };
        return { ok: true, ...appearance };
      } catch {
        return { ok: false, message: '无法确认本机主题设置，请重新读取后重试。' };
      }
    },
    result: view,
    rejectPending(id: string, owner: string, message: string): ThemeCommand | undefined {
      const item = commands.get(id);
      if (!item || item.owner !== owner) return undefined;
      if (item.result.state === 'pending') {
        item.result = {
          ...item.result,
          state: 'rejected',
          current: false,
          can_undo: false,
          message,
        };
      }
      return { ...item.result };
    },
    undo(id: string, owner: string): AppearanceResponse {
      const status = view(id, owner);
      if (!status.ok || !status.command) return status;
      const item = commands.get(id)!;
      if (item.result.state === 'undone') return status;
      if (!status.command.can_undo)
        return failed('主题或操作状态已变化，不能覆盖后来的选择；请核对当前主题。');
      item.result.can_undo = false;
      const saved = application.execute({
        protocol_version: 1,
        operation: 'set',
        theme: item.result.before,
      });
      item.revision = revision;
      item.result.state = saved.ok && saved.theme === item.result.before ? 'undone' : 'unknown';
      item.result.message =
        item.result.state === 'undone' ? '已撤销本次主题修改。' : '撤销结果待核对；未自动重试。';
      return view(id, owner);
    },
    prepare(owner: string, target: Theme): ThemeCommand | undefined {
      if (!owner || commands.size >= 200) return undefined;
      try {
        const before = read();
        const result: ThemeCommand = {
          id: crypto.randomUUID(),
          before,
          after: target,
          state: 'pending',
          can_undo: false,
          message: '等待模型提出本次已授权的主题操作。',
        };
        commands.set(result.id, { owner, revision, result });
        return { ...result };
      } catch {
        return undefined;
      }
    },
    propose(id: string, owner: string, input: unknown): ThemeCommand {
      const item = commands.get(id);
      if (!item || item.owner !== owner) throw new Error('Theme authorization expired');
      if (item.result.state !== 'pending') return { ...item.result };
      const parsed = themeProposalSchema.safeParse(input);
      const status = view(id, owner);
      if (
        !parsed.success ||
        parsed.data.theme !== item.result.after ||
        !status.ok ||
        item.revision !== revision ||
        status.theme !== item.result.before
      ) {
        item.result.state = 'rejected';
        item.result.message = '主题提案或当前设置已变化，本次未修改。';
        return { ...item.result };
      }
      if (status.theme === item.result.after) {
        item.result.state = 'unchanged';
        item.result.message = '当前已是该主题，无需修改。';
        return { ...item.result };
      }
      // 先消耗本次授权；同步写入异常后也只能查询，不能重复调用模型或重放写入。
      item.result.state = 'unknown';
      const saved = application.execute({
        protocol_version: 1,
        operation: 'set',
        theme: item.result.after,
      });
      item.revision = revision;
      if (saved.ok && saved.theme === item.result.after) {
        item.result.state = 'saved';
        item.result.can_undo = true;
        item.result.message = '主题已保存，等待界面应用核对。';
      } else item.result.message = '主题保存结果待核对；未自动重试。';
      return { ...item.result };
    },
    release(owner?: string) {
      for (const [id, item] of commands) if (!owner || item.owner === owner) commands.delete(id);
    },
  };
  return application;
}
