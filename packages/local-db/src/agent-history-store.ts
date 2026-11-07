import type Database from 'better-sqlite3';
import { agentRunSchema, type AgentRun } from '@caselite/contracts';
export function createAgentHistoryStore(db: Database.Database, workspace: string) {
  type StoredRun = { scope: string; payload: string };
  // 保留旧版 JSON 的合法范围值，让回退版可继续读首页/任务历史。
  // 项目真实范围只由原 scope 列恢复；空 UUID 不对应可创建的任务。
  const legacyProjectPlaceholder = '00000000-0000-0000-0000-000000000000';
  const encode = (run: AgentRun, now: string) => {
    const document = run.scope.startsWith('document:');
    const project = run.scope.startsWith('project:') || document;
    return JSON.stringify({
      ...run,
      scope: project ? legacyProjectPlaceholder : run.scope,
      // 旧版恢复会重写 running 并丢弃未知字段。对旧版只暴露终态，新版仍按 running 恢复。
      ...(project && run.status === 'running'
        ? { status: 'interrupted', project_running: true }
        : {}),
      updated_at: now,
    });
  };
  const decode = (row: StoredRun) => {
    const stored = JSON.parse(row.payload);
    const payload = agentRunSchema.parse(stored);
    if (!row.scope.startsWith('project:') && !row.scope.startsWith('document:')) return payload;
    if (payload.scope !== legacyProjectPlaceholder) throw new Error('Invalid stored project run');
    return agentRunSchema.parse({
      ...payload,
      scope: row.scope,
      status:
        payload.status === 'interrupted' && stored.project_running === true
          ? 'running'
          : payload.status,
    });
  };
  const load = () =>
    (
      db
        .prepare('SELECT scope,payload FROM agent_runs WHERE workspace_id=? ORDER BY rowid')
        .all(workspace) as StoredRun[]
    ).map(decode);
  const equivalent = (run: AgentRun) => JSON.stringify({ ...run, updated_at: undefined });
  const register = (input: AgentRun) =>
    db.transaction(() => {
      const run = agentRunSchema.parse(input),
        now = new Date().toISOString();
      const r = db
        .prepare(
          'INSERT INTO agent_runs(id,workspace_id,scope,sequence,created_at,updated_at,payload) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
        )
        .run(
          run.id,
          workspace,
          run.scope,
          run.sequence,
          run.created_at ?? now,
          now,
          encode(run, now),
        );
      if (r.changes === 1) return { created: true, run };
      const old = db
        .prepare('SELECT scope,payload FROM agent_runs WHERE id=? AND workspace_id=?')
        .get(run.id, workspace) as StoredRun | undefined;
      if (!old) throw new Error('Run identity conflict');
      return { created: false, run: decode(old) };
    })();
  const save = (input: AgentRun) =>
    db.transaction(() => {
      // 这里只更新已登记Run；输入身份固定，不能借检查点覆盖其他收费请求。
      const incoming = agentRunSchema.parse(input),
        row = db
          .prepare('SELECT scope,payload FROM agent_runs WHERE id=? AND workspace_id=?')
          .get(incoming.id, workspace) as StoredRun | undefined;
      if (!row) throw new Error('Run not registered');
      const old = decode(row);
      // 运行检查点不得覆盖用户刚保存的置顶状态；两者共用同一事务连接。
      const run = { ...incoming, pinned: old.pinned };
      if (
        old.scope !== run.scope ||
        old.prompt !== run.prompt ||
        old.context_id !== run.context_id ||
        old.project_fingerprint !== run.project_fingerprint ||
        JSON.stringify(old.attachments) !== JSON.stringify(run.attachments) ||
        old.model !== run.model ||
        old.provider !== run.provider ||
        run.sequence < old.sequence
      )
        throw new Error('Run identity or sequence conflict');
      if (run.sequence === old.sequence) {
        if (equivalent(run) !== equivalent(old))
          throw new Error('Conflicting same-sequence update');
        return;
      }
      const now = new Date().toISOString();
      db.prepare(
        'UPDATE agent_runs SET sequence=?,updated_at=?,payload=? WHERE id=? AND workspace_id=?',
      ).run(run.sequence, now, encode(run, now), run.id, workspace);
    })();
  return {
    save,
    register,
    load,
    pinnedIds: () =>
      (
        db
          .prepare(
            "SELECT id FROM agent_runs WHERE workspace_id=? AND json_extract(payload,'$.pinned')=1",
          )
          .all(workspace) as { id: string }[]
      ).map((row) => row.id),
    setPinned: (id: string, pinned: boolean) =>
      db.transaction(() => {
        const row = db
          .prepare(
            "SELECT json_extract(payload,'$.pinned') AS pinned FROM agent_runs WHERE id=? AND workspace_id=?",
          )
          .get(id, workspace) as { pinned: number } | undefined;
        if (!row) return 'NOT_FOUND' as const;
        if (pinned && !row.pinned) {
          const count = db
            .prepare(
              "SELECT count(*) AS n FROM agent_runs WHERE workspace_id=? AND json_extract(payload,'$.pinned')=1",
            )
            .get(workspace) as { n: number };
          if (count.n >= 3) return 'LIMIT' as const;
        }
        db.prepare(
          "UPDATE agent_runs SET payload=json_set(payload,'$.pinned',json(?)) WHERE id=? AND workspace_id=?",
        ).run(pinned ? 'true' : 'false', id, workspace);
        return 'OK' as const;
      })(),
    recoverInterrupted: () =>
      db.transaction(() => {
        for (const run of load())
          if (run.status === 'running') {
            run.status = 'interrupted';
            run.sequence++;
            run.usage = null;
            run.message =
              '上次运行被中断，保留已落盘的部分结果；远端处理及费用可能未知，未自动重试。';
            save(run);
          }
      })(),
  };
}
