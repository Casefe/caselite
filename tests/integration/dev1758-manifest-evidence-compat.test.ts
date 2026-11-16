import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPiRuntime } from '../../apps/desktop/src/main/adapters/pi-runtime';
import { createMaterialFiles } from '../../apps/desktop/src/main/adapters/material-files';
import { createMaterialApplication } from '../../packages/application/src/material-application';
import { openTaskStore } from '../../packages/local-db/src/task-store';
import {
  renderSelectedInput,
  selectedInputManifestSchema,
  type SelectedInputItem,
} from '../../packages/contracts/src/agent-input';
import {
  materialPreviewSchema,
  type Material,
  type MaterialPreview,
  type MaterialResponse,
  type TextPage,
} from '../../packages/contracts/src/material';
import { sourceRefSchema } from '../../packages/contracts/src/source';

// DEV-1758：隔离试做切片。消费 DEV-1651 真实预览产物，对照 DEV-1580 Manifest 与 DEV-1579 SourceRef/EvidenceRef。
// 本轮不修改 CaseLite 生产代码，不新建第二输入装配器，所有已知分歧固定为测试断言，供后续实施卡/Owner 有意更新。
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const migrations = resolve('packages/local-db/migrations');
const fixture = resolve('tests/fixtures/case-materials/development/contract-v1-text.pdf');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const basePage = { blocks: [], width: 595, height: 842, rotation: 0 };
const pdfPage: TextPage = {
  ...basePage,
  page: 1,
  origin: 'pdf_text',
  text: '合成合同付款条款：甲方应于交付后十日内支付货款。',
};
const ocrPage: TextPage = {
  ...basePage,
  page: 2,
  origin: 'ocr_candidate',
  text: '合成OCR候选：违约金为合同总价的百分之五。',
};
const unselectedPage: TextPage = {
  ...basePage,
  page: 3,
  origin: 'pdf_text',
  text: 'UNSELECTED_PAGE_SENTINEL_TEXT',
};

function ok(result: MaterialResponse) {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function setup(pages: TextPage[]) {
  const root = mkdtempSync(join(tmpdir(), 'caselite-dev1758-gemini-'));
  roots.push(root);
  const store = openTaskStore(join(root, 'db.sqlite'), migrations);
  const app = createMaterialApplication({
    inputCapability: createPiRuntime().inputCapability,
    store: store.materials,
    files: createMaterialFiles(join(root, 'materials')),
    processor: {
      configuration: 'dev1758-gemini-synthetic-v1',
      inspect: async () => pages.length,
      process: async (_bytes, input) => pages.forEach((page) => input.onPage(page)),
    },
    id: randomUUID,
    hash: sha,
    taskExists: (id) => store.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
    createTask(token, name) {
      const r = store.execute({
        protocol_version: 1,
        operation: 'create',
        request_id: randomUUID(),
        idempotency_key: token,
        title: name,
        objective: '',
      });
      if (!r.ok) throw new Error(r.message);
      return r.tasks[0].id;
    },
  });

  async function addReady(): Promise<Material> {
    const staged = ok(await app.stage(fixture, 'home')).staged!;
    ok(
      await app.execute({
        protocol_version: 1,
        scope: 'home',
        operation: 'commit',
        token: staged.token,
      }),
    );
    for (let i = 0; i < 200; i++) {
      const listed = ok(
        await app.execute({ protocol_version: 1, scope: 'home', operation: 'list' }),
      );
      if (listed.materials.every((item) => item.status !== 'processing')) {
        return listed.materials.at(-1)!;
      }
      await new Promise((done) => setTimeout(done, 5));
    }
    throw new Error('Processing timeout');
  }

  const preview = (source: Material, pageNumbers: number[], instruction = '列出付款与违约条款') =>
    app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'preview',
      instruction,
      model: 'gpt-4.1-mini',
      selected: [{ source_id: source.id, pages: pageNumbers }],
    });

  return { store, app, addReady, preview };
}

// 模拟测试内只读映射探针：对照 1651 preview 与 1580 SelectedInputItem 字段差异
function probeManifestItems(material: Material, preview: MaterialPreview): SelectedInputItem[] {
  return preview.selections.flatMap((selection) =>
    selection.pages.map((number) => {
      const page = material.pages.find((item) => item.page === number)!;
      return {
        kind: 'source_excerpt' as const,
        selection_id: randomUUID(),
        text: page.text,
        content_sha256: sha(page.text),
        // 1651仅具有 source_id 与页码，没有独立 SourceVersion 或 Anchor 记录
        source_ref: { source_version_id: selection.source_id, anchor_id: selection.source_id },
        asset_sha256: material.sha256,
        role:
          page.origin === 'ocr_candidate'
            ? ('ocr_candidate' as const)
            : ('original_quote' as const),
      };
    }),
  );
}

function probeManifest(material: Material, preview: MaterialPreview, payloadText: string) {
  return {
    manifest_id: randomUUID(),
    task_id: preview.task_id,
    task_version: 1,
    run_id: randomUUID(),
    provider: 'openai' as const,
    model: preview.model,
    instruction: preview.instruction,
    selected: probeManifestItems(material, preview),
    excluded: [],
    payload_text: payloadText,
    payload_sha256: sha(payloadText),
    confirmed_preview_id: preview.id,
  };
}

describe('DEV-1758 1651 preview vs 1580 Manifest/SourceRef compatibility', () => {
  it('compatible: real preview hash is recomputable, page-scoped, deduped and single-send frozen', async () => {
    const s = setup([pdfPage, ocrPage, unselectedPage]);
    try {
      const material = await s.addReady();
      // 请求乱序及重复页 [2, 1, 2]，验证去重和排序
      const preview = ok(await s.preview(material, [2, 1, 2])).preview!;

      expect(materialPreviewSchema.parse(preview)).toEqual(preview);
      // 哈希可由 payload 确定性复算
      expect(preview.sha256).toBe(sha(preview.payload));
      expect(preview.images).toBeUndefined();
      expect(preview.selections).toEqual([
        {
          source_id: material.id,
          derivation_id: material.derivation_id,
          name: material.name,
          pages: [1, 2],
        },
      ]);

      // 仅包含选中页，未选中页绝不进入载荷
      expect(preview.payload).toContain(pdfPage.text);
      expect(preview.payload).toContain(ocrPage.text);
      expect(preview.payload).not.toContain(unselectedPage.text);

      // 角色可见性：原文与 OCR 标签在载荷中清晰可见
      expect(preview.payload).toContain('物理页 1｜PDF 文字]');
      expect(preview.payload).toContain('物理页 2｜OCR 文字，待核对]');

      const items = probeManifestItems(material, preview);
      expect(items.map((item) => item.kind === 'source_excerpt' && item.role)).toEqual([
        'original_quote',
        'ocr_candidate',
      ]);
      expect(
        items.every(
          (item) => item.kind === 'source_excerpt' && item.asset_sha256 === material.sha256,
        ),
      ).toBe(true);

      // 单次发送冻结验证：resolveContext 返回与 preview.payload 严格一致的正文
      const context = await s.app.resolveContext(
        preview.id,
        'home',
        preview.instruction,
        preview.model,
      );
      expect(context).toMatchObject({ text: preview.payload });

      // 持久化与重启读回一致性
      expect(s.store.materials.preview(preview.id, 'home')).toEqual(preview);
    } finally {
      s.store.close();
    }
  });

  it('compatible: duplicate sources, missing pages, stale derivations and scope switches are rejected', async () => {
    const s = setup([pdfPage, ocrPage]);
    try {
      const material = await s.addReady();
      const preview = ok(await s.preview(material, [1])).preview!;

      // 重复来源拒绝
      const duplicate = await s.app.execute({
        protocol_version: 1,
        scope: 'home',
        operation: 'preview',
        instruction: preview.instruction,
        model: 'gpt-4.1-mini',
        selected: [
          { source_id: material.id, pages: [1] },
          { source_id: material.id, pages: [2] },
        ],
      });
      expect(duplicate).toMatchObject({ ok: false, code: 'MATERIAL_UNAVAILABLE' });

      // 缺页拒绝
      expect(await s.preview(material, [99])).toMatchObject({
        ok: false,
        code: 'MATERIAL_UNAVAILABLE',
      });

      // 重新处理（生成新 derivation）后旧预览失效为 STALE_PREVIEW
      ok(
        await s.app.execute({
          protocol_version: 1,
          scope: 'home',
          operation: 'process',
          source_id: material.id,
          ocr: true,
          force: true,
        }),
      );
      for (let i = 0; i < 200; i++) {
        const listed = ok(
          await s.app.execute({ protocol_version: 1, scope: 'home', operation: 'list' }),
        );
        if (listed.materials.every((item) => item.status !== 'processing')) break;
        await new Promise((done) => setTimeout(done, 5));
      }
      expect(s.store.materials.get(material.id)?.derivation_id).not.toBe(material.derivation_id);
      await expect(
        s.app.resolveContext(preview.id, 'home', preview.instruction, preview.model),
      ).rejects.toThrow('STALE_PREVIEW');

      // 切换 Task 作用域后无法再读取旧预览
      const fresh = ok(await s.preview(await s.addReady(), [1])).preview!;
      ok(await s.app.execute({ protocol_version: 1, scope: 'home', operation: 'new_home' }));
      await expect(
        s.app.resolveContext(fresh.id, 'home', fresh.instruction, fresh.model),
      ).rejects.toThrow();
    } finally {
      s.store.close();
    }
  });

  it('known gap: 1651 preview serialization differs from renderSelectedInput so payload hashes cannot be shared directly', async () => {
    const s = setup([pdfPage, ocrPage]);
    try {
      const material = await s.addReady();
      const preview = ok(await s.preview(material, [1, 2])).preview!;

      // 尝试直接将 1651 preview.payload 送入 1580 selectedInputManifestSchema 校验
      const asIs = selectedInputManifestSchema.safeParse(
        probeManifest(material, preview, preview.payload),
      );
      expect(asIs.success).toBe(false);
      expect(asIs.error?.issues.map((issue) => issue.message)).toContain(
        'Payload differs from the fixed preview',
      );

      // 对照组：经过 renderSelectedInput 序列化后方可满足 1580 Manifest 要求
      const items = probeManifestItems(material, preview);
      const rendered = renderSelectedInput(preview.instruction, items);
      expect(rendered).not.toBe(preview.payload);
      expect(sha(rendered)).not.toBe(preview.sha256);
      expect(
        selectedInputManifestSchema.safeParse({
          ...probeManifest(material, preview, rendered),
          selected: items,
        }).success,
      ).toBe(true);
    } finally {
      s.store.close();
    }
  });

  it('known gap: legal 1651 payload above 4000 characters is rejected by 1580 Manifest text limit', async () => {
    const longPage: TextPage = { ...pdfPage, text: '合成长付款条款与合同明细内容。'.repeat(300) };
    const s = setup([longPage]);
    try {
      const material = await s.addReady();
      const preview = ok(await s.preview(material, [1])).preview!;

      // 1651 载荷支持高达 256 KiB 且按 utf8-byte-proxy-v1 计量预算
      expect(preview.payload.length).toBeGreaterThan(4000);
      expect(preview.budget?.policy).toBe('utf8-byte-proxy-v1');

      // 1580 Manifest 设定 text.max(4000) 会阻断该合法材料预览
      const items = probeManifestItems(material, preview);
      const rendered = renderSelectedInput(preview.instruction, items);
      const manifest = selectedInputManifestSchema.safeParse({
        ...probeManifest(material, preview, rendered),
        selected: items,
      });
      expect(manifest.success).toBe(false);
      expect(manifest.error?.issues.some((issue) => issue.code === 'too_big')).toBe(true);
    } finally {
      s.store.close();
    }
  });

  it('known gap: 1651 selections are page-level and lack SourceVersion, Anchor, and excluded metadata', async () => {
    const s = setup([pdfPage]);
    try {
      const material = await s.addReady();
      const preview = ok(await s.preview(material, [1])).preview!;

      // 1651 selections 仅包含 derivation_id, name, pages, source_id
      expect(Object.keys(preview.selections[0]).sort()).toEqual([
        'derivation_id',
        'name',
        'pages',
        'source_id',
      ]);

      // 无法直接通过 sourceRefSchema（需要 source_version_id 和 anchor_id）
      expect(
        sourceRefSchema.safeParse({ source_id: material.id, pages: preview.selections[0].pages })
          .success,
      ).toBe(false);

      // 1651 preview 不包含 excluded 记录，而 1580 Manifest 要求追踪排除原因
      expect('excluded' in preview).toBe(false);
    } finally {
      s.store.close();
    }
  });
});
