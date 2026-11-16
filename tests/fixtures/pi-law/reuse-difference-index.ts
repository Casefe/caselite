import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const statusSchema = z.enum(['PASS_REAL', 'MOCK_ONLY', 'NOT_RUN', 'BLOCKED', 'FAIL']);
const entrySchema = z
  .object({
    id: z.string().min(1),
    owner_issue: z.string().regex(/^DEV-\d+$/),
    status: statusSchema,
    evidence: z.string().min(1).nullable(),
    summary: z.string().min(1),
  })
  .strict();
export const reuseDifferenceIndexSchema = z
  .object({
    issue: z.literal('DEV-1767'),
    baseline_role: z.string().min(1),
    entries: z.array(entrySchema).min(1),
  })
  .strict();
export type ReuseDifferenceIndex = z.infer<typeof reuseDifferenceIndexSchema>;

const fixtureDir = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(fixtureDir, '../../..');
const keptByOwner = new Set(['DEV-1657', 'DEV-1655']);
const forbiddenPiTokens = ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'pi-runtime'];

// 1657/1655的通过不能写进本索引。PASS_REAL只允许指向本卡实际检查，且文件必须还在。
export function assertReuseDifferenceBoundaries(
  index: ReuseDifferenceIndex,
  root = repositoryRoot,
) {
  const ids = index.entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('重复的差异索引条目');
  for (const entry of index.entries) {
    if (keptByOwner.has(entry.owner_issue)) {
      if (entry.status !== 'NOT_RUN' || entry.evidence !== null)
        throw new Error(`${entry.owner_issue}的验收仍由原卡接收`);
    } else if (entry.status === 'PASS_REAL' && entry.owner_issue !== 'DEV-1767') {
      throw new Error(`${entry.id}不能代替其他卡通过`);
    }
    if (entry.status === 'PASS_REAL') {
      if (!entry.evidence) throw new Error(`${entry.id}缺少证据文件`);
      if (!existsSync(join(root, entry.evidence))) throw new Error(`${entry.id}的证据文件不存在`);
    }
  }
  for (const [id, owner] of [
    ['product-acceptance', 'DEV-1657'],
    ['candidate-acceptance', 'DEV-1655'],
  ] as const) {
    const entry = index.entries.find((item) => item.id === id);
    if (!entry || entry.owner_issue !== owner || entry.status !== 'NOT_RUN' || entry.evidence)
      throw new Error(`${owner}的验收条目被改写`);
  }
}

export function loadReuseDifferenceIndex(root = repositoryRoot) {
  const index = reuseDifferenceIndexSchema.parse(
    JSON.parse(
      readFileSync(join(root, 'tests/fixtures/pi-law/reuse-difference-index.json'), 'utf8'),
    ),
  );
  assertReuseDifferenceBoundaries(index, root);
  return index;
}

function walkSources(directory: string, files: string[]) {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(directory, name);
    const info = statSync(path);
    if (info.isDirectory()) walkSources(path, files);
    else if (/\.(?:ts|tsx|mjs|cjs|js)$/.test(name)) files.push(path);
  }
}

// 持久化Owner不引用Pi。命中时退出读回不再成立，调用方应停止把索引标成PASS_REAL。
export function piImportHits(root: string, folders: string[]) {
  const files: string[] = [];
  for (const folder of folders) {
    const directory = join(root, folder);
    // 目录尚未创建时没有可引用Pi的源码；创建后同一检查继续覆盖。
    if (existsSync(directory)) walkSources(directory, files);
  }
  return files.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return forbiddenPiTokens
      .filter((token) => source.includes(token))
      .map((token) => `${relative(root, file)} 引用 ${token}`);
  });
}
