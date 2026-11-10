import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('bakes the test-build choice into the bundle and ignores a later runtime environment change', () => {
  const program = `
    import webpack from 'webpack';
    import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
    import {tmpdir} from 'node:os';
    import {join,resolve} from 'node:path';
    import {createRequire} from 'node:module';
    import config from './apps/desktop/webpack.main.config.mjs';
    const dir=mkdtempSync(join(tmpdir(),'caselite-local-build-'));
    try {
      writeFileSync(join(dir,'input.cjs'), 'process.env.CASELITE_LOCAL_TEST_BUILD="1"; module.exports=CASELITE_LOCAL_TEST_BUILD;');
      const compiler=webpack({mode:'production',target:'node',entry:join(dir,'input.cjs'),plugins:config.plugins,output:{path:dir,filename:'compiled.cjs',library:{type:'commonjs2'}}});
      await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error??new Error(stats.toString())):resolve())));
      const require=createRequire(resolve('package.json'));
      process.stdout.write(JSON.stringify(require(join(dir,'compiled.cjs'))));
    } finally {rmSync(dir,{recursive:true,force:true});}
  `;
  for (const [buildValue, expected] of [
    ['', false],
    ['true', false],
    ['1', true],
  ] as const) {
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: process.cwd(),
      env: { ...process.env, CASELITE_LOCAL_TEST_BUILD: buildValue },
      encoding: 'utf8',
    });
    expect(JSON.parse(result)).toBe(expected);
  }
});
