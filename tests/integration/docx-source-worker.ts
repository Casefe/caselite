import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

// 用已安装TypeScript擦除真实处理器/Worker的类型；仍运行真实worker_threads，不模拟转换结果。
// 此探针不替代Forge打包、Electron或Word验收，临时输出只在既有可重建目录中保留到测试结束。
export function sourceDocxProcessor() {
  const parent = resolve('apps/desktop/.webpack');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'docx-regression-'));
  try {
    for (const name of ['docx-worker', 'docx-processor']) {
      const input = resolve(`apps/desktop/src/main/adapters/${name}.ts`);
      const output = ts.transpileModule(readFileSync(input, 'utf8'), {
        fileName: input,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      });
      writeFileSync(join(root, `${name}.cjs`), output.outputText);
    }
    const load = createRequire(resolve('apps/desktop/package.json'));
    const api = load(
      join(root, 'docx-processor.cjs'),
    ) as typeof import('../../apps/desktop/src/main/adapters/docx-processor');
    return { api, dispose: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
