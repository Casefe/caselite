import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const fixturesRoot = path.join(repositoryRoot, 'tests/fixtures/case-materials');
const sourcesRoot = path.join(fixturesRoot, 'source');
const developmentRoot = path.join(fixturesRoot, 'development');
const regressionRoot = path.join(fixturesRoot, 'regression');
const manifestPath = path.join(fixturesRoot, 'manifest.json');
const argumentsList = process.argv.slice(2);
if (argumentsList.length > 1 || (argumentsList.length === 1 && argumentsList[0] !== '--refresh')) {
  throw new Error('只支持 --refresh；默认命令校验已固定的样本，不改写文件。');
}
const refresh = argumentsList[0] === '--refresh';

const sourceFiles = [
  {
    id: 'development-contract-v1-text',
    source: 'contract-v1.txt',
    output: 'development/contract-v1-text.pdf',
    purpose: '开发集：可检索文本 PDF，作为 v1 原件样本。',
    textLayer: 'expected',
  },
  {
    id: 'development-contract-v2-text',
    source: 'contract-v2.txt',
    output: 'development/contract-v2-text.pdf',
    purpose: '开发集：仅变更付款期限的 v2 文本 PDF。',
    textLayer: 'expected',
  },
  {
    id: 'regression-supply-contract-v1-text',
    source: 'supply-contract-v1.txt',
    output: 'regression/supply-contract-v1-text.pdf',
    purpose: '独立回归集：不同 Matter 的合成采购合同。',
    textLayer: 'expected',
  },
];

function run(command, argumentsList) {
  return execFileSync(command, argumentsList, {
    cwd: repositoryRoot,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function writePdfFromText(sourcePath, outputPath, title) {
  const output = run('/usr/sbin/cupsfilter', [
    '-i',
    'text/plain',
    '-m',
    'application/pdf',
    '-o',
    'media=A4',
    '-t',
    title,
    sourcePath,
  ]);
  writeFileSync(outputPath, output);
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function relativeToFixtures(filePath) {
  return path.relative(fixturesRoot, filePath).split(path.sep).join('/');
}

function verifyFrozenFixtures() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.files.length !== sourceFiles.length + 2) {
    throw new Error('样本清单版本或文件数量不符；请检查 manifest.json。');
  }

  const filesById = new Map(manifest.files.map((file) => [file.id, file]));
  if (filesById.size !== manifest.files.length) {
    throw new Error('样本清单包含重复 ID。');
  }
  const expectedFiles = new Map([
    ...sourceFiles.map((sample) => [sample.id, sample.output]),
    ['development-contract-v1-scan', 'development/contract-v1-scan.pdf'],
    ['development-damaged-pdf', 'development/damaged.pdf'],
  ]);

  for (const sample of sourceFiles) {
    const entry = filesById.get(sample.id);
    if (entry?.path !== sample.output) {
      throw new Error(`样本清单缺少预期文件：${sample.id}`);
    }
    if (entry.sourceSha256 !== sha256(path.join(sourcesRoot, sample.source))) {
      throw new Error(`源文本已变化：${sample.source}；请审核后使用 --refresh 更新样本。`);
    }
  }

  for (const entry of manifest.files) {
    if (
      expectedFiles.get(entry.id) !== entry.path ||
      entry.sha256 !== sha256(path.join(fixturesRoot, entry.path))
    ) {
      throw new Error(`固定样本缺失或哈希不符：${entry.path}`);
    }
  }

  console.log(
    `固定样本校验通过：${manifest.files.length} 个文件与 ${sourceFiles.length} 个源文本；未改写文件。`,
  );
}

if (!refresh) {
  verifyFrozenFixtures();
  process.exit(0);
}

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'caselite-case-materials-'));
try {
  mkdirSync(developmentRoot, { recursive: true });
  mkdirSync(regressionRoot, { recursive: true });

  for (const sample of sourceFiles) {
    const sourcePath = path.join(sourcesRoot, sample.source);
    const outputPath = path.join(fixturesRoot, sample.output);

    if (!existsSync(sourcePath)) {
      throw new Error(`缺少样本文本源文件：${sample.source}`);
    }

    writePdfFromText(sourcePath, outputPath, sample.id);
  }

  const scanSource = path.join(developmentRoot, 'contract-v1-text.pdf');
  const scanPng = path.join(temporaryRoot, 'contract-v1-scan.png');
  const scanOutput = path.join(developmentRoot, 'contract-v1-scan.pdf');

  run('/usr/bin/sips', ['-s', 'format', 'png', scanSource, '--out', scanPng]);
  const scanPdf = run('/usr/sbin/cupsfilter', [
    '-i',
    'image/png',
    '-m',
    'application/pdf',
    '-o',
    'media=A4',
    '-t',
    'development-contract-v1-scan',
    scanPng,
  ]);
  writeFileSync(scanOutput, scanPdf);

  const manifest = {
    schemaVersion: 1,
    purpose: 'CaseLite DEV-1560 的合成、公开、固定测试样本；不得替换为真实法律资料。',
    generator: 'pnpm fixtures:case-materials --refresh（macOS CUPS + sips；须人工复核）',
    files: [
      ...sourceFiles.map((sample) => {
        const outputPath = path.join(fixturesRoot, sample.output);
        return {
          id: sample.id,
          path: sample.output,
          sha256: sha256(outputPath),
          sourceSha256: sha256(path.join(sourcesRoot, sample.source)),
          purpose: sample.purpose,
          textLayer: sample.textLayer,
        };
      }),
      {
        id: 'development-contract-v1-scan',
        path: 'development/contract-v1-scan.pdf',
        sha256: sha256(scanOutput),
        purpose: '开发集：由 v1 文本 PDF 栅格化生成的无文本层扫描副本。',
        textLayer: 'none',
      },
      {
        id: 'development-damaged-pdf',
        path: 'development/damaged.pdf',
        sha256: sha256(path.join(developmentRoot, 'damaged.pdf')),
        purpose: '开发集：故意损坏的伪 PDF；导入/阅读必须安全拒绝。',
        textLayer: 'invalid',
      },
    ],
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`已生成 ${manifest.files.length} 个 CaseLite 合成样本。`);
  console.log(`清单：${relativeToFixtures(manifestPath)}`);
  console.log('请检查 PDF 差异并重新进行人工确认；CUPS 生成的二进制内容可能随环境变化。');
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true, maxRetries: 2, retryDelay: 100 });
}
