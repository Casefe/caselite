import { z } from 'zod';

// 固定版本只引用原正文Owner的不可变修订；不接收renderer提供的正文或法律确认。
export const deliverySnapshotSchema = z
  .object({
    id: z.string().uuid(),
    document_id: z.string().uuid(),
    task_id: z.string().uuid(),
    body_id: z.string().uuid(),
    body_revision: z.number().int().positive(),
    editor_schema: z.literal(1),
    metadata_version: z.number().int().positive(),
    task_version: z.number().int().positive(),
    title: z.string().min(1).max(160),
    collection: z.string().max(80),
    tags: z.array(z.string().min(1).max(40)).max(20),
    note: z.string().max(200),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    created_at: z.iso.datetime(),
    created_by: z.literal('local'),
    kind: z.literal('draft'),
    // 当前正文白名单尚无SourceRef节点；不因快照自动纳入任务材料。
    source_refs: z.tuple([]),
  })
  .strict();
export type DeliverySnapshot = z.infer<typeof deliverySnapshotSchema>;
