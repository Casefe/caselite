import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  defaultLocalPreferences,
  localPreferenceValuesSchema,
  localPreferencesSchema,
  localPreferencesResponseSchema,
  type LocalPreferences,
  type LocalPreferencesRequest,
  type LocalPreferencesResponse,
} from '@caselite/contracts';

export function createLocalPreferencesStore(db: Database.Database, workspace: string) {
  const read = (): LocalPreferences => {
    const row = db
      .prepare('SELECT value,version FROM local_preferences WHERE workspace_id=?')
      .get(workspace) as { value: string; version: number } | undefined;
    return row
      ? localPreferencesSchema.parse({ ...JSON.parse(row.value), version: row.version })
      : { ...defaultLocalPreferences };
  };
  return {
    execute(request: LocalPreferencesRequest): LocalPreferencesResponse {
      if (request.operation === 'read') return { ok: true, preferences: read(), receipt: null };
      const previous = () =>
        db
          .prepare(
            'SELECT digest,result FROM local_preference_receipts WHERE workspace_id=? AND key=?',
          )
          .get(workspace, request.idempotency_key) as
          { digest: string; result: string } | undefined;
      if (request.operation === 'status') {
        const receipt = previous();
        return receipt
          ? localPreferencesResponseSchema.parse(JSON.parse(receipt.result))
          : {
              ok: false,
              code: 'NOT_FOUND',
              message: '尚未找到此设置提交的回执，可保留原提交后重试。',
            };
      }
      return db
        .transaction((): LocalPreferencesResponse => {
          const { request_id, ...content } = request;
          void request_id;
          const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
          const receipt = previous();
          if (receipt)
            return receipt.digest === digest
              ? localPreferencesResponseSchema.parse(JSON.parse(receipt.result))
              : {
                  ok: false,
                  code: 'CONFLICT',
                  message: '原提交身份已用于其他设置，请核对原提交。',
                };
          const current = read();
          if (current.version !== request.expected_version)
            return {
              ok: false,
              code: 'CONFLICT',
              message: '设置已被其他窗口修改，请重新读取；本次输入已保留。',
            };
          const values = localPreferenceValuesSchema.parse({
            ...request.values,
            // 旧客户端只提交原有字段时保留已选方案；摘要仍绑定原请求。
            ...(request.values.editor_mode === undefined && current.editor_mode !== undefined
              ? { editor_mode: current.editor_mode }
              : {}),
            ...(request.values.calendar_layout === undefined &&
            current.calendar_layout !== undefined
              ? { calendar_layout: current.calendar_layout }
              : {}),
            ...(request.values.writing_skills === undefined && current.writing_skills !== undefined
              ? { writing_skills: current.writing_skills }
              : {}),
          });
          const next = { ...values, version: current.version + 1 };
          // 资料、版本与原键回执同事务；未知结果只能核对原键，不能换键重复写入。
          db.prepare(
            'INSERT INTO local_preferences(workspace_id,value,version) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET value=excluded.value,version=excluded.version',
          ).run(workspace, JSON.stringify(values), next.version);
          const result: LocalPreferencesResponse = {
            ok: true,
            preferences: next,
            receipt: request.idempotency_key,
          };
          db.prepare(
            'INSERT INTO local_preference_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
          ).run(workspace, request.idempotency_key, digest, JSON.stringify(result));
          return result;
        })
        .immediate();
    },
  };
}
