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
const f = (path: string, text = '---\nname: a\ndescription: d\n---\nbody') => ({
  path,
  kind: 'file',
  bytes: enc.encode(text),
});
const code = (files: unknown) => {
  const r = previewSkillImport({ files });
  return r.status === 'rejected' ? r.code : r.status;
};
test('拒绝所有逃逸路径和归一化冲突', () => {
  for (const path of [
    '../x',
    '/etc/x',
    'C:/x',
    '\\\\host\\x',
    'a\\x',
    'a//x',
    'a/./x',
    'a/../x',
    'a/\u0000x',
    Array(13).fill('x').join('/'),
  ])
    assert.equal(code([f(path)]), 'UNSAFE_PATH', path);
  assert.equal(code([f('a/SKILL.md'), f('A/skill.md')]), 'DUPLICATE_PATH');
  assert.equal(code([f('a/é.md'), f('a/e\u0301.md')]), 'DUPLICATE_PATH');
});
test('拒绝 symlink、非文件、坏字节和不合法输入', () => {
  assert.equal(code([{ ...f('a/SKILL.md'), kind: 'symlink' }]), 'SYMLINK');
  assert.equal(code([{ ...f('a/SKILL.md'), kind: 'directory' }]), 'INVALID_FILE');
  assert.equal(code([{ ...f('a/SKILL.md'), bytes: new Uint8Array([0xff]) }]), 'INVALID_UTF8');
  assert.equal(
    code([f('a/SKILL.md'), { ...f('a/references/x.md'), bytes: new Uint8Array([0xff]) }]),
    'INVALID_UTF8',
  );
  assert.equal(code([f('a/other.md')]), 'SKILL_NOT_FOUND');
});
test('拒绝超出文件数、单文件大小和包总量预算', () => {
  assert.equal(code(Array.from({ length: 501 }, (_, i) => f(`a/${i}`))), 'INVALID_FILE_COUNT');
  assert.equal(
    code([{ ...f('a/SKILL.md'), bytes: new Uint8Array(5 * 1024 * 1024 + 1) }]),
    'FILE_TOO_LARGE',
  );
  assert.equal(
    code(
      Array.from({ length: 7 }, (_, i) => ({
        ...f(`a/${i}`),
        bytes: new Uint8Array(5 * 1024 * 1024),
      })),
    ),
    'PACKAGE_TOO_LARGE',
  );
});
test('frontmatter 缺失、未闭合、重复及必填值不合法', () => {
  assert.equal(code([f('a/SKILL.md', 'body')]), 'FRONTMATTER_MISSING');
  assert.equal(code([f('a/SKILL.md', '---\nname: a')]), 'FRONTMATTER_UNCLOSED');
  assert.equal(
    code([f('a/SKILL.md', '---\nname: a\nname: b\ndescription: d\n---\nx')]),
    'DUPLICATE_FIELD',
  );
  assert.equal(
    code([f('a/SKILL.md', '---\nname: [bad]\ndescription: d\n---\nx')]),
    'REQUIRED_FIELD_UNSUPPORTED_OR_MISSING',
  );
});
test('历史比较输入受限且不自授访问权限', () => {
  assert.deepEqual(
    previewSkillImport({ files: [f('a/SKILL.md')], priorCandidates: [{ id: 'x' }] }),
    { status: 'rejected', code: 'INVALID_PRIOR' },
  );
  assert.deepEqual(previewSkillImport({ files: [f('a/SKILL.md')], priorManifestSha256: ['bad'] }), {
    status: 'rejected',
    code: 'INVALID_PRIOR',
  });
});

test('历史相似指纹由宿主显式供给并严格限长', () => {
  const result = previewSkillImport({
    files: [f('a/SKILL.md')],
    priorCandidates: [
      {
        id: 'x',
        kind: 'method',
        name: 'x',
        rawSha256: 'a'.repeat(64),
        normalizedSha256: 'b'.repeat(64),
        similaritySha256: 'invalid',
      },
    ],
  });
  assert.deepEqual(result, { status: 'rejected', code: 'INVALID_PRIOR' });
});
