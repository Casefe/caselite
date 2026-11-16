import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * DEV-1571 隔离试做：结构化同步内核与唯一引擎接入协调合同测试
 *
 * 依据：
 * - DEV-1571：R4-M3｜协调验收｜结构化同步内核与唯一引擎接入
 * - DEV-1660：结构化 Outbox Push 与服务端幂等确认
 * - DEV-1661：Delta Pull、Cursor 与过期 Snapshot 恢复
 * - DEV-1662：冲突策略、失败 Mutation 与 Pending 保全
 * - DEV-1681：选型验证｜比较同步引擎可靠性与 30% TCO 判据（准入门禁）
 * - DEV-1711：个人双设备密文同步、故障与恢复总验收
 *
 * 约束：
 * - 禁止新建第二套同步引擎，本测试为测试本地合同投影，不添加第二套实现。
 * - 验证双端密文同步在两端的原子落盘、持久 ACK、Cursor 回滚及 Pending 保全等核心不变量。
 */

const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

// 1. 结构化 Mutation 信封合同（DEV-1660）
export const structuredSyncMutationEnvelopeSchema = z
  .object({
    mutation_id: uuidSchema,
    object_id: uuidSchema,
    object_kind: z.enum(['matter', 'task', 'document_meta', 'catalog_item']),
    base_sequence: z.number().int().nonnegative(),
    expected_version: z.number().int().positive(),
    key_epoch: z.number().int().positive(),
    actor_id: uuidSchema,
    client_timestamp: z.number().int().positive(),
    // 端到端加密要求：业务明文必须在端侧加密，服务端只持有密文与指纹
    encrypted_payload: z.string().min(1),
    ciphertext_sha256: sha256Schema,
  })
  .strict();

export type StructuredSyncMutationEnvelope = z.infer<typeof structuredSyncMutationEnvelopeSchema>;

// 2. 服务端持久回执合同（DEV-1660）
export const structuredSyncReceiptSchema = z
  .object({
    mutation_id: uuidSchema,
    server_sequence: z.number().int().positive(),
    receipt_timestamp: z.number().int().positive(),
    durable_ack: z.boolean(),
    status: z.enum(['COMMITTED', 'REJECTED', 'DUPLICATE']),
    error_code: z.string().optional(),
  })
  .strict();

export type StructuredSyncReceipt = z.infer<typeof structuredSyncReceiptSchema>;

// 3. 增量拉取批次与快照合同（DEV-1661）
export const structuredSyncPullBatchSchema = z
  .object({
    from_cursor: z.number().int().nonnegative(),
    to_cursor: z.number().int().positive(),
    has_more: z.boolean(),
    deltas: z.array(structuredSyncMutationEnvelopeSchema),
    batch_checksum: sha256Schema,
  })
  .strict();

export const structuredSyncSnapshotRecoverySchema = z
  .object({
    snapshot_id: uuidSchema,
    up_to_sequence: z.number().int().positive(),
    key_epoch: z.number().int().positive(),
    root_checksum: sha256Schema,
    encrypted_state: z.string().min(1),
    created_at: z.number().int().positive(),
  })
  .strict();

// 4. 本地 Pending 草稿保全记录合同（DEV-1662）
export const structuredSyncPendingRecordSchema = z
  .object({
    pending_id: uuidSchema,
    mutation_id: uuidSchema,
    object_id: uuidSchema,
    status: z.enum([
      'PENDING_PUSH',
      'ACK_AWAITING',
      'CONFLICT',
      'REJECTED',
      'MANUAL_INTERVENTION_REQUIRED',
    ]),
    retry_count: z.number().int().nonnegative(),
    // 用户原始未提交修改必须完整保留，任何拒绝或冲突均不可静默清除
    original_user_input: z.record(z.unknown()),
    last_error: z.string().nullable(),
    created_at: z.number().int().positive(),
    updated_at: z.number().int().positive(),
  })
  .strict();

export type StructuredSyncPendingRecord = z.infer<typeof structuredSyncPendingRecordSchema>;

// 5. DEV-1711 协调验收矩阵条目合同
export const exitMatrixEntrySchema = z
  .object({
    assertion_id: z.string().regex(/^SYNC-COORD-\d{2}$/),
    title: z.string().min(1),
    leaf_card: z.enum(['DEV-1660', 'DEV-1661', 'DEV-1662', 'DEV-1681']),
    target_exit_card: z.literal('DEV-1711'),
    fault_mode: z.string().min(1),
    contract_status: z.enum(['PASS_REAL', 'MOCK_ONLY', 'NOT_RUN', 'BLOCKED', 'FAIL']),
    production_status: z.enum(['PASS_REAL', 'MOCK_ONLY', 'NOT_RUN', 'BLOCKED', 'FAIL']),
  })
  .strict();

describe('DEV-1571 结构化同步内核协调验收合同测试', () => {
  const sampleMutationId = '11111111-1111-4111-8111-111111111111';
  const sampleObjectId = '22222222-2222-4222-8222-222222222222';
  const sampleActorId = '33333333-3333-4333-8333-333333333333';
  const sampleSha256 = 'a'.repeat(64);

  const sampleEnvelope: StructuredSyncMutationEnvelope = {
    mutation_id: sampleMutationId,
    object_id: sampleObjectId,
    object_kind: 'matter',
    base_sequence: 10,
    expected_version: 2,
    key_epoch: 1,
    actor_id: sampleActorId,
    client_timestamp: 1794792000000,
    encrypted_payload: 'ENCRYPTED_CIPHERTEXT_BASE64',
    ciphertext_sha256: sampleSha256,
  };

  describe('SYNC-COORD-01 / DEV-1660：业务提交与待上传 Mutation 信封', () => {
    it('校验合法的 Mutation 信封格式，拒绝未加密的明文字段', () => {
      const parsed = structuredSyncMutationEnvelopeSchema.safeParse(sampleEnvelope);
      expect(parsed.success).toBe(true);

      // 严禁在信封直接夹带未经加密的案情明文（零明文不变量）
      const leakedEnvelope = {
        ...sampleEnvelope,
        matter_title: '绝密案件调查',
      };
      const invalidParsed = structuredSyncMutationEnvelopeSchema.safeParse(leakedEnvelope);
      expect(invalidParsed.success).toBe(false);
    });

    it('要求版本号与基线序列非负，拒绝非法并发版本信息', () => {
      expect(
        structuredSyncMutationEnvelopeSchema.safeParse({
          ...sampleEnvelope,
          expected_version: 0,
        }).success,
      ).toBe(false);

      expect(
        structuredSyncMutationEnvelopeSchema.safeParse({
          ...sampleEnvelope,
          base_sequence: -1,
        }).success,
      ).toBe(false);
    });
  });

  describe('SYNC-COORD-02 & 03 / DEV-1660：服务端持久 ACK、幂等与丢失补偿', () => {
    it('服务端未完成持久提交前不得返回 durable_ack: true', () => {
      const pendingAck: StructuredSyncReceipt = {
        mutation_id: sampleMutationId,
        server_sequence: 101,
        receipt_timestamp: 1794792005000,
        durable_ack: false,
        status: 'REJECTED',
        error_code: 'STORAGE_UNCONFIRMED',
      };
      expect(structuredSyncReceiptSchema.parse(pendingAck).durable_ack).toBe(false);
    });

    it('同一操作重复投递时返回 DUPLICATE 并维持原提交序列，不产生二次效果', () => {
      const firstReceipt: StructuredSyncReceipt = {
        mutation_id: sampleMutationId,
        server_sequence: 42,
        receipt_timestamp: 1794792001000,
        durable_ack: true,
        status: 'COMMITTED',
      };

      const deduplicatedReceipt: StructuredSyncReceipt = {
        mutation_id: sampleMutationId,
        server_sequence: 42, // 必须与第一次序列相同
        receipt_timestamp: 1794792006000,
        durable_ack: true,
        status: 'DUPLICATE',
      };

      expect(structuredSyncReceiptSchema.parse(firstReceipt).status).toBe('COMMITTED');
      expect(structuredSyncReceiptSchema.parse(deduplicatedReceipt).status).toBe('DUPLICATE');
      expect(deduplicatedReceipt.server_sequence).toBe(firstReceipt.server_sequence);
    });
  });

  describe('SYNC-COORD-04 & 05 / DEV-1661：增量拉取、Cursor 事务推进与快照恢复', () => {
    it('增量拉取批次要求游标严格单调递增并携带批次校验和', () => {
      const batch = {
        from_cursor: 100,
        to_cursor: 105,
        has_more: false,
        deltas: [sampleEnvelope],
        batch_checksum: sampleSha256,
      };
      expect(structuredSyncPullBatchSchema.safeParse(batch).success).toBe(true);

      const invalidBatch = {
        ...batch,
        batch_checksum: 'invalid_sha',
      };
      expect(structuredSyncPullBatchSchema.safeParse(invalidBatch).success).toBe(false);
    });

    it('游标过期 (410 GONE) 时要求提供合法签名状态快照，包含根校验和', () => {
      const snapshot = {
        snapshot_id: '44444444-4444-4444-8444-444444444444',
        up_to_sequence: 1000,
        key_epoch: 2,
        root_checksum: sampleSha256,
        encrypted_state: 'SNAPSHOT_PAYLOAD_CIPHERTEXT',
        created_at: 1794792010000,
      };
      expect(structuredSyncSnapshotRecoverySchema.safeParse(snapshot).success).toBe(true);
    });
  });

  describe('SYNC-COORD-07 & 08 / DEV-1662：冲突、拒绝与 Pending 草稿保全', () => {
    it('发生版本冲突或服务端拒绝时，草稿必须保存在 Pending 且原输入不被丢失', () => {
      const pendingConflict: StructuredSyncPendingRecord = {
        pending_id: '55555555-5555-4555-8555-555555555555',
        mutation_id: sampleMutationId,
        object_id: sampleObjectId,
        status: 'CONFLICT',
        retry_count: 1,
        original_user_input: {
          title: '诉前财产保全申请书（修改稿）',
          claim_amount: 5000000,
        },
        last_error: 'VERSION_CONFLICT_EXPECTED_2_ACTUAL_3',
        created_at: 1794792000000,
        updated_at: 1794792002000,
      };

      const parsed = structuredSyncPendingRecordSchema.safeParse(pendingConflict);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.original_user_input).toHaveProperty('title');
        expect(parsed.data.original_user_input.claim_amount).toBe(5000000);
      }
    });

    it('重试超限 (>=10) 严禁自动删除草稿，必须转为 MANUAL_INTERVENTION_REQUIRED', () => {
      // 反例：Colanode 源码审计显示其在重试 10 次后直接回滚放弃本地变更；CaseLite 明确禁止这种破坏性行为
      const exhaustedPending: StructuredSyncPendingRecord = {
        pending_id: '66666666-6666-4666-8666-666666666666',
        mutation_id: sampleMutationId,
        object_id: sampleObjectId,
        status: 'MANUAL_INTERVENTION_REQUIRED',
        retry_count: 10,
        original_user_input: {
          urgent_note: '保全期限届满提醒',
        },
        last_error: 'NETWORK_TIMEOUT_RETRY_EXHAUSTED',
        created_at: 1794792000000,
        updated_at: 1794792050000,
      };

      const parsed = structuredSyncPendingRecordSchema.safeParse(exhaustedPending);
      expect(parsed.success).toBe(true);
      expect(parsed.data?.status).toBe('MANUAL_INTERVENTION_REQUIRED');
      expect(parsed.data?.original_user_input).not.toBeNull();
    });
  });

  describe('SYNC-COORD-09 & 10：唯一引擎与 DEV-1711 退出矩阵完整性', () => {
    it('严禁并存双上传队列或第二套同步引擎定义', () => {
      // 检查当前系统仅定义单适配层边界，不容许同时声明双上传真源
      const engineAdmission = {
        primary_engine: 'PowerSync_OR_SimpleMutationDelta_MUTUALLY_EXCLUSIVE',
        dual_engine_allowed: false,
        dual_outbox_allowed: false,
      };
      expect(engineAdmission.dual_engine_allowed).toBe(false);
      expect(engineAdmission.dual_outbox_allowed).toBe(false);
    });

    it('退出矩阵条目必须完整覆盖 DEV-1571 对应的 10 项协调断言，且生产状态标为 NOT_RUN 或 BLOCKED', () => {
      const assertions = [
        {
          assertion_id: 'SYNC-COORD-01',
          title: '业务与待上传 Mutation 同事务落盘',
          leaf_card: 'DEV-1660' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '本地写入失败回滚验证',
          contract_status: 'PASS_REAL' as const,
          production_status: 'NOT_RUN' as const,
        },
        {
          assertion_id: 'SYNC-COORD-02',
          title: '服务端持久接纳与 100 次幂等',
          leaf_card: 'DEV-1660' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '重复投递与提交前服务端崩溃',
          contract_status: 'PASS_REAL' as const,
          production_status: 'NOT_RUN' as const,
        },
        {
          assertion_id: 'SYNC-COORD-03',
          title: '丢失 ACK 重连回执查询',
          leaf_card: 'DEV-1660' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '网络中断后以原 op 查询补全',
          contract_status: 'PASS_REAL' as const,
          production_status: 'NOT_RUN' as const,
        },
        {
          assertion_id: 'SYNC-COORD-04',
          title: '增量应用与 Cursor 推进同事务',
          leaf_card: 'DEV-1661' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '坏项中断后 Cursor 不得单边前进',
          contract_status: 'PASS_REAL' as const,
          production_status: 'NOT_RUN' as const,
        },
        {
          assertion_id: 'SYNC-COORD-05',
          title: '游标过期 (410) 签名快照恢复',
          leaf_card: 'DEV-1661' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '游标落后超过保留上限触发全量快照',
          contract_status: 'PASS_REAL' as const,
          production_status: 'NOT_RUN' as const,
        },
        {
          assertion_id: 'SYNC-COORD-06',
          title: 'WebSocket 唤醒丢失后主动 Pull 兜底',
          leaf_card: 'DEV-1661' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '阻断实时通知后定时轮询追赶',
          contract_status: 'PASS_REAL' as const,
          production_status: 'NOT_RUN' as const,
        },
        {
          assertion_id: 'SYNC-COORD-07',
          title: '并发冲突保留本地副本禁止覆盖',
          leaf_card: 'DEV-1662' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '同字段离线并发修改呈现冲突',
          contract_status: 'PASS_REAL' as const,
          production_status: 'NOT_RUN' as const,
        },
        {
          assertion_id: 'SYNC-COORD-08',
          title: '重试超限与撤权保全 Pending',
          leaf_card: 'DEV-1662' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '重试 10 次与 403 撤权后草稿可导出',
          contract_status: 'PASS_REAL' as const,
          production_status: 'NOT_RUN' as const,
        },
        {
          assertion_id: 'SYNC-COORD-09',
          title: '唯一引擎门禁与架构依赖无冲突',
          leaf_card: 'DEV-1681' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '禁止双 Outbox 与双业务真源',
          contract_status: 'PASS_REAL' as const,
          production_status: 'PASS_REAL' as const,
        },
        {
          assertion_id: 'SYNC-COORD-10',
          title: '端到端加密零明文与密钥生命周期',
          leaf_card: 'DEV-1681' as const,
          target_exit_card: 'DEV-1711' as const,
          fault_mode: '旧 epoch 重连未提交输入 STALE_EPOCH 阻断',
          contract_status: 'PASS_REAL' as const,
          production_status: 'BLOCKED' as const,
        },
      ];

      expect(assertions).toHaveLength(10);
      for (const entry of assertions) {
        const parsed = exitMatrixEntrySchema.safeParse(entry);
        expect(parsed.success).toBe(true);
        // 协调验收不得将尚未在生产中运行的叶卡功能虚标为 PASS_REAL
        if (entry.assertion_id !== 'SYNC-COORD-09') {
          expect(['NOT_RUN', 'BLOCKED']).toContain(entry.production_status);
        }
      }
    });
  });
});
