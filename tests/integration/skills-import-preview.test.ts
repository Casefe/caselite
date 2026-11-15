import { createHash } from 'node:crypto';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { previewSkillImport as convertSkillImport } from '../../packages/application/src/skills-import-preview';

const previewSkillImport = (input: unknown) =>
  convertSkillImport(input, {
    createSha256() {
      const hash = createHash('sha256');
      return {
        update(bytes) {
          hash.update(bytes);
          return this;
        },
        digestHex() {
          return hash.digest('hex');
        },
      };
    },
  });
const enc = new TextEncoder();
const file = (path: string, text: string) => ({
  path,
  kind: 'file' as const,
  bytes: enc.encode(text),
});
const skill = (name = 'demo', extra = '', body = 'A method.\n') =>
  `---\nname: ${name}\ndescription: Example skill\n${extra}---\n${body}`;
const run = (files: ReturnType<typeof file>[], extra = {}) =>
  previewSkillImport({ files, ...extra });
const ok = (result: ReturnType<typeof previewSkillImport>) => {
  assert.equal(result.status, 'preview');
  if (result.status !== 'preview') throw Error('expected preview');
  return result;
};

test('完整合成输入输出、来源和隔离', () => {
  const files = [
    file(
      '.claude/skills/demo/SKILL.md',
      skill('demo', 'license: MIT\nversion: "1"\nallowed-tools: Shell\ncustom: value\n'),
    ),
    file('.claude/skills/demo/templates/form.md', '# Form\n'),
    file('.claude/skills/demo/references/check.md', '- [ ] Verify\n'),
    file('.claude/skills/demo/scripts/run.sh', 'throw executed'),
    file('.claude/skills/demo/assets/image.bin', 'asset'),
    file('.claude/skills/demo/hooks/hook.md', 'never execute'),
  ];
  const before = files.map((f) => Buffer.from(f.bytes));
  const result = ok(run(files));
  assert.deepEqual(
    result.candidates.map((c) => c.kind),
    ['method', 'reference', 'rule', 'template'],
  );
  assert.equal(result.skills[0].platform, 'claude');
  assert.equal(result.skills[0].toolDeclarations[0], 'allowed-tools: Shell');
  assert.ok(result.skills[0].unsupported.includes('custom: value'));
  assert.equal(result.candidates[0].sourceStartLine, 9);
  assert.equal(result.candidates[0].sourceLicense, 'MIT');
  assert.equal(result.candidates[0].sourceVersion, '1');
  assert.equal(result.files.filter((f) => f.classification === 'quarantined').length, 2);
  assert.equal(
    result.files.find((f) => f.path.endsWith('image.bin'))?.classification,
    'unsupported',
  );
  assert.deepEqual(
    files.map((f) => Buffer.from(f.bytes)),
    before,
  );
});
test('包排序无关且脚本、版本、许可或权限变化改变原始包指纹', () => {
  const original = [
    file('x/SKILL.md', skill('x', 'license: MIT\nversion: "1"\nallowed-tools: A\n')),
    file('x/scripts/run.sh', 'one'),
  ];
  const first = ok(run(original));
  assert.equal(ok(run([...original].reverse())).manifestSha256, first.manifestSha256);
  assert.deepEqual(
    ok(run(original, { priorManifestSha256: [first.manifestSha256] })).exactManifestMatches,
    [first.manifestSha256],
  );
  for (const changed of [
    skill('x', 'license: Apache\nversion: "1"\nallowed-tools: A\n'),
    skill('x', 'license: MIT\nversion: "2"\nallowed-tools: A\n'),
    skill('x', 'license: MIT\nversion: "1"\nallowed-tools: B\n'),
  ])
    assert.notEqual(
      ok(run([file('x/SKILL.md', changed), original[1]])).manifestSha256,
      first.manifestSha256,
    );
  assert.notEqual(
    ok(run([original[0], file('x/scripts/run.sh', 'two')])).manifestSha256,
    first.manifestSha256,
  );
});
test('候选原始与归一化重复、同名版本和内容近似只提示人工复核', () => {
  const body =
    'This is a long enough shared prefix for a human review suggestion in this sample.\n';
  const p = ok(
    run([
      file('a/SKILL.md', skill('one', '', body)),
      file('a/references/a.md', 'Same  \r\nText\r\n'),
      file('a/references/b.md', 'Same\nText\n'),
      file('b/SKILL.md', skill('one', '', body + 'Different ending')),
    ]),
  );
  assert.ok(
    p.candidates
      .find((c) => c.sourcePath.endsWith('b.md'))
      ?.duplicates.some((h) => h.relation === 'exact-normalized' && h.action === 'review'),
  );
  assert.ok(
    p.candidates
      .find((c) => c.sourcePath === 'b/SKILL.md')
      ?.duplicates.some((h) => h.relation === 'same-name'),
  );
  const q = ok(
    run([file('z/SKILL.md', skill('other', '', body + 'Different ending'))], {
      priorCandidates: [p.candidates[0]],
    }),
  );
  assert.ok(
    q.candidates[0].duplicates.some((h) => h.relation === 'similar' && h.action === 'review'),
  );
  const distinct = ok(
    run(
      [
        file(
          'z/SKILL.md',
          skill(
            'different',
            '',
            'A completely unrelated and independently authored text for this scenario.',
          ),
        ),
      ],
      { priorCandidates: [p.candidates[0]] },
    ),
  );
  assert.equal(distinct.candidates[0].duplicates.length, 0);
  assert.equal(
    ok(run([file('z/SKILL.md', skill('other', '', body + 'Different ending'))])).candidates[0]
      .duplicates.length,
    0,
  );
  const similar = ok(
    run([
      file('a/SKILL.md', skill('first', '', body + '1')),
      file('b/SKILL.md', skill('second', '', body + '2')),
    ]),
  );
  assert.ok(similar.candidates[1].duplicates.some((h) => h.relation === 'similar'));
  const exact = ok(
    run([file('a/SKILL.md', skill())], {
      priorCandidates: [ok(run([file('b/SKILL.md', skill())])).candidates[0]],
    }),
  );
  assert.equal(exact.candidates[0].duplicates[0].relation, 'exact-raw');
  const oldReference = p.candidates.find((candidate) => candidate.sourcePath.endsWith('a.md'))!;
  const normalizedPrior = ok(
    run([file('z/SKILL.md', skill()), file('z/references/new.md', 'Same\nText\n')], {
      priorCandidates: [oldReference],
    }),
  );
  assert.equal(
    normalizedPrior.candidates.find((candidate) => candidate.kind === 'reference')?.duplicates[0]
      .relation,
    'exact-normalized',
  );
});
test('不同平台扩展字段保留，缺许可明确标记', () => {
  for (const [path, platform] of [
    ['.cursor/skills/a/SKILL.md', 'cursor'],
    ['.gemini/skills/a/SKILL.md', 'gemini'],
    ['.codex/skills/a/SKILL.md', 'codex'],
    ['.agents/skills/a/SKILL.md', 'agent-skills'],
  ]) {
    const p = ok(run([file(path, skill('a', 'paths: src\n'))]));
    assert.equal(p.skills[0].platform, platform);
    assert.equal(p.skills[0].metadata.paths, 'src');
    assert.ok(p.skills[0].unsupported.includes('paths: src'));
    assert.equal(p.skills[0].license, null);
    assert.match(p.warnings[0], /license unverified/);
  }
  assert.equal(
    ok(run([file('a/SKILL.md', skill('a', 'display_name: 示例\n'))])).skills[0].platform,
    'workbuddy',
  );
});
test('复杂 YAML 保留原始扩展并不生成候选', () => {
  const p = ok(
    run([
      file('a/SKILL.md', skill('a', 'metadata:\n  version: "1"\n')),
      file('a/templates/a.md', 'template'),
    ]),
  );
  assert.match(p.skills[0].rawFrontmatter, /metadata:/);
  assert.equal(p.candidates.length, 0);
  assert.ok(p.skills[0].unsupported.length);
});
test('最近 Skill 根归属避免嵌套包吞并', () => {
  const p = ok(
    run([
      file('outer/SKILL.md', skill('outer')),
      file('outer/inner/SKILL.md', skill('inner', 'license: Inner\n')),
      file('outer/inner/templates/t.md', 'Inner template'),
    ]),
  );
  const t = p.candidates.find((c) => c.kind === 'template');
  assert.equal(t?.skillPath, 'outer/inner/SKILL.md');
  assert.equal(t?.sourceLicense, 'Inner');
});
test('脚本扩展、声明和任意外部路径只作为数据不执行或读取', () => {
  const p = ok(
    run([
      file(
        'x/SKILL.md',
        skill('x', 'allowed-tools: Shell\n', 'read /secret and https://example.invalid\n'),
      ),
      file('x/references/go.py', 'process.exit(55)'),
      file('x/hooks/on.md', 'do'),
    ]),
  );
  assert.equal(p.files.filter((f) => f.classification === 'quarantined').length, 2);
  assert.equal(p.candidates.length, 1);
});
test('取消、重复预览无状态，原始输入保留', () => {
  const files = [file('a/SKILL.md', skill())];
  const before = Buffer.from(files[0].bytes);
  assert.deepEqual(run(files, { cancelled: true }), { status: 'cancelled' });
  assert.deepEqual(run(files), run(files));
  assert.deepEqual(Buffer.from(files[0].bytes), before);
});
test('BOM 和 CRLF 接受且来源位置正确', () => {
  const p = ok(
    run([file('a/SKILL.md', '\ufeff---\r\nname: a\r\ndescription: d\r\n---\r\nline\r\n')]),
  );
  assert.equal(p.candidates[0].sourceStartLine, 5);
  assert.equal(p.candidates[0].text, 'line\r\n');
});

test('候选数量边界独立于重复提示，超限拒绝完整预览', () => {
  const methods = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      file(`skill-${i}/SKILL.md`, skill(`method-${i}`, '', `Body ${i}`)),
    );
  const atLimit = ok(run(methods(100)));
  assert.equal(atLimit.candidates.length, 100);
  assert.equal(atLimit.candidates.flatMap((candidate) => candidate.duplicates).length, 0);
  assert.deepEqual(run(methods(101)), { status: 'rejected', code: 'CANDIDATE_LIMIT_EXCEEDED' });
});
test('历史比较预算在没有重复提示时仍拒绝超限工作量', () => {
  const old = ok(run([file('old/SKILL.md', skill('old'))])).candidates[0];
  const unique = Array.from({ length: 500 }, (_, i) => ({
    ...old,
    id: `prior-${i}`,
    name: `different-${i}`,
    rawSha256: 'a'.repeat(64),
    normalizedSha256: 'b'.repeat(64),
    similaritySha256: null,
  }));
  const methods = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      file(`skill-${i}/SKILL.md`, skill(`method-${i}`, '', `Body ${i}`)),
    );
  const belowLimit = ok(run(methods(9), { priorCandidates: unique }));
  assert.equal(belowLimit.candidates.length, 9);
  assert.equal(belowLimit.candidates.flatMap((candidate) => candidate.duplicates).length, 0);
  assert.deepEqual(run(methods(10), { priorCandidates: unique }), {
    status: 'rejected',
    code: 'COMPARISON_LIMIT_EXCEEDED',
  });
});
test('重复提示预算阻断同名放大，不以截断结果冒充成功', () => {
  const methods = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      file(`skill-${i}/SKILL.md`, skill('same-name', '', `Body ${i}`)),
    );
  const belowLimit = ok(run(methods(45)));
  assert.equal(belowLimit.candidates.flatMap((candidate) => candidate.duplicates).length, 990);
  assert.deepEqual(run(methods(46)), { status: 'rejected', code: 'HINT_LIMIT_EXCEEDED' });
  const rows = (n: number) => Array.from({ length: n }, () => '- [ ] repeated check').join('\n');
  assert.equal(
    ok(run([file('x/SKILL.md', skill('x')), file('x/references/check.md', rows(4))])).candidates
      .length,
    6,
  );
  assert.deepEqual(
    run([file('x/SKILL.md', skill('x')), file('x/references/check.md', rows(300))]),
    { status: 'rejected', code: 'HINT_LIMIT_EXCEEDED' },
  );
});
test('单引号仅接受成对转义，非法及尾随内容拒绝', () => {
  assert.equal(ok(run([file('x/SKILL.md', skill("'a''b'"))])).skills[0].name, "a'b");
  assert.deepEqual(run([file('x/SKILL.md', skill("'a'b'"))]), {
    status: 'rejected',
    code: 'REQUIRED_FIELD_UNSUPPORTED_OR_MISSING',
  });
  assert.deepEqual(run([file('x/SKILL.md', skill("'abc' trailing"))]), {
    status: 'rejected',
    code: 'REQUIRED_FIELD_UNSUPPORTED_OR_MISSING',
  });
  const unsupported = ok(
    run([
      file('x/SKILL.md', skill('valid', "custom: 'a'b'\n")),
      file('x/templates/form.md', 'withheld'),
    ]),
  );
  assert.equal(unsupported.candidates.length, 0);
  assert.ok(unsupported.skills[0].unsupported.includes("custom: 'a'b'"));
  assert.match(unsupported.skills[0].rawFrontmatter, /custom: 'a'b'/);
});
