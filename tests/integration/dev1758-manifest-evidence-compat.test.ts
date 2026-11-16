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

// DEV-1758：只消费1651真实预览产物并对照1580 Manifest/SourceRef，不新增装配器或产品代码。
// “已知差异”断言固定当前分歧；1651/1580收口后必须由对应Owner有意更新，不能静默放宽。
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
  text: 'UNSELECTED_PAGE_SENTINEL',
};

function ok(result: MaterialResponse) {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function setup(pages: TextPage[]) {
  const root = mkdtempSync(join(tmpdir(), 'caselite-dev1758-'));
  roots.push(root);
  const store = openTaskStore(join(root, 'db.sqlite'), migrations);
  const app = createMaterialApplication({
    inputCapability: createPiRuntime().inputCapability,
    store: store.materials,
    files: createMaterialFiles(join(root, 'materials')),
    processor: {
      configuration: 'dev1758-synthetic-v1',
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
      if (listed.materials.every((item) => item.status !== 'processing'))
        return listed.materials.at(-1)!;
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

// 测试内的只读映射探针：说明1651产物离1580 Manifest还差哪些字段，不是第二装配器。
function probeManifestItems(material: Material, preview: MaterialPreview): SelectedInputItem[] {
  return preview.selections.flatMap((selection) =>
    selection.pages.map((number) => {
      const page = material.pages.find((item) => item.page === number)!;
      return {
        kind: 'source_excerpt' as const,
        selection_id: randomUUID(),
        text: page.text,
        content_sha256: sha(page.text),
        // 1651只有source_id＋页码；没有SourceVersion/Anchor身份，这里只能以source_id占位。
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
    provider: 'openai',
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
  it('compatible: real preview hash is recomputable, scoped to selected pages and frozen for one send', async () => {
    const s = setup([pdfPage, ocrPage, unselectedPage]);
    try {
      const material = await s.addReady();
      const preview = ok(await s.preview(material, [2, 1, 2])).preview!;
      expect(materialPreviewSchema.parse(preview)).toEqual(preview);
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
      expect(preview.payload).toContain(pdfPage.text);
      expect(preview.payload).toContain(ocrPage.text);
      expect(preview.payload).not.toContain(unselectedPage.text);
      // 原文/OCR角色在载荷标签中可见，可映射到1580的original_quote/ocr_candidate。
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
      const context = await s.app.resolveContext(
        preview.id,
        'home',
        preview.instruction,
        preview.model,
      );
      expect(context).toMatchObject({ text: preview.payload });
      expect(s.store.materials.preview(preview.id, 'home')).toEqual(preview);
    } finally {
      s.store.close();
    }
  });

  it('compatible: duplicate, missing page, old derivation and changed task scope never reach the request', async () => {
    const s = setup([pdfPage, ocrPage]);
    try {
      const material = await s.addReady();
      const preview = ok(await s.preview(material, [1])).preview!;
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
      expect(await s.preview(material, [9])).toMatchObject({
        ok: false,
        code: 'MATERIAL_UNAVAILABLE',
      });
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
      const fresh = ok(await s.preview(await s.addReady(), [1])).preview!;
      ok(await s.app.execute({ protocol_version: 1, scope: 'home', operation: 'new_home' }));
      await expect(
        s.app.resolveContext(fresh.id, 'home', fresh.instruction, fresh.model),
      ).rejects.toThrow();
    } finally {
      s.store.close();
    }
  });

  it('known gap: 1651 payload serialization differs from renderSelectedInput, so hashes cannot be shared', async () => {
    const s = setup([pdfPage, ocrPage]);
    try {
      const material = await s.addReady();
      const preview = ok(await s.preview(material, [1, 2])).preview!;
      const asIs = selectedInputManifestSchema.safeParse(
        probeManifest(material, preview, preview.payload),
      );
      expect(asIs.success).toBe(false);
      expect(asIs.error?.issues.map((issue) => issue.message)).toContain(
        'Payload differs from the fixed preview',
      );
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

  it('known gap: legal 1651 payload above 4000 chars is rejected by the 1580 Manifest text cap', async () => {
    const longPage: TextPage = { ...pdfPage, text: '合成长段落。'.repeat(900) };
    const s = setup([longPage]);
    try {
      const material = await s.addReady();
      const preview = ok(await s.preview(material, [1])).preview!;
      expect(preview.payload.length).toBeGreaterThan(4000);
      expect(preview.budget?.policy).toBe('utf8-byte-proxy-v1');
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

  it('known gap: 1651 selections are page-level without SourceVersion/Anchor, excluded or search-scope records', async () => {
    const s = setup([pdfPage]);
    try {
      const material = await s.addReady();
      const preview = ok(await s.preview(material, [1])).preview!;
      expect(Object.keys(preview.selections[0]).sort()).toEqual([
        'derivation_id',
        'name',
        'pages',
        'source_id',
      ]);
      expect(
        sourceRefSchema.safeParse({ source_id: material.id, pages: preview.selections[0].pages })
          .success,
      ).toBe(false);
      expect(preview).not.toHaveProperty('excluded');
      expect(preview).not.toHaveProperty('search_scope');
      expect(preview).not.toHaveProperty('payload_sha256');
    } finally {
      s.store.close();
    }
  });
});
