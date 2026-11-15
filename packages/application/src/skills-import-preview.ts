import type {
  CandidateKind,
  DuplicateHint,
  PriorCandidate,
  SkillCandidate,
  SkillFileRecord,
  SkillInputFile,
  SkillPreviewResult,
} from '@caselite/contracts';

const MAX_FILES = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_DEPTH = 12;
const MAX_PRIOR = 500;
const MAX_CANDIDATES = 100;
const MAX_COMPARISONS = 5000;
const MAX_HINTS = 1000;
const encoder = new TextEncoder();
export interface SkillPreviewHasher {
  update(data: Uint8Array): SkillPreviewHasher;
  digestHex(): string;
}
export interface SkillPreviewHashPort {
  createSha256(): SkillPreviewHasher;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function checkedFiles(value: unknown): SkillInputFile[] {
  if (!Array.isArray(value) || value.length > MAX_FILES) throw new Error('INVALID_FILE_COUNT');
  const seen = new Set<string>();
  let total = 0;
  return value.map((file: unknown) => {
    if (!isRecord(file) || typeof file.path !== 'string' || !(file.bytes instanceof Uint8Array))
      throw new Error('INVALID_FILE');
    if (file.kind !== 'file') throw new Error(file.kind === 'symlink' ? 'SYMLINK' : 'INVALID_FILE');
    const path = file.path;
    const parts = path.split('/');
    if (
      !path ||
      path.length > 4096 ||
      path.startsWith('/') ||
      /^[A-Za-z]:/.test(path) ||
      Array.from(path).some(
        (character) =>
          character === '\\' || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      parts.length > MAX_DEPTH ||
      parts.some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('UNSAFE_PATH');
    const key = path.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error('DUPLICATE_PATH');
    seen.add(key);
    if (file.bytes.byteLength > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
    total += file.bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new Error('PACKAGE_TOO_LARGE');
    return { path, kind: 'file' as const, bytes: file.bytes };
  });
}
function checkedPrior(value: unknown): PriorCandidate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PRIOR) throw new Error('INVALID_PRIOR');
  const kinds = ['method', 'reference', 'template', 'rule'];
  return value.map((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !item.id ||
      item.id.length > 4096 ||
      typeof item.name !== 'string' ||
      item.name.length > 4096 ||
      typeof item.kind !== 'string' ||
      !kinds.includes(item.kind) ||
      typeof item.rawSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.rawSha256) ||
      typeof item.normalizedSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.normalizedSha256) ||
      (item.similaritySha256 !== undefined &&
        item.similaritySha256 !== null &&
        (typeof item.similaritySha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(item.similaritySha256)))
    )
      throw new Error('INVALID_PRIOR');
    return item as unknown as PriorCandidate;
  });
}
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('INVALID_UTF8');
  }
}
function normalized(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
}
function manifest(files: SkillInputFile[], hashing: SkillPreviewHashPort): string {
  const hash = hashing.createSha256();
  // 长度前缀和排序防止文件名或内容边界产生相同拼接。
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const path = encoder.encode(file.path);
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, path.length);
    view.setUint32(4, file.bytes.byteLength);
    hash.update(header).update(path).update(file.bytes);
  }
  return hash.digestHex();
}
function parseSkill(data: Uint8Array) {
  const text = decode(data);
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[0] !== '---') throw new Error('FRONTMATTER_MISSING');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('FRONTMATTER_UNCLOSED');
  const rawFrontmatter = lines.slice(1, end).join('\n');
  const metadata: Record<string, string> = Object.create(null) as Record<string, string>;
  const unsupported: string[] = [];
  let complex = false;
  const keys = new Set<string>();
  const toolDeclarations: string[] = [];
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/.exec(line);
    if (!match) {
      unsupported.push(line);
      complex = true;
      continue;
    }
    const [, key, original = ''] = match;
    if (keys.has(key)) throw new Error('DUPLICATE_FIELD');
    keys.add(key);
    if (key === 'allowed-tools' || key === 'tools' || key === 'hooks') toolDeclarations.push(line);
    let value = original.trim();
    if (value.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed !== 'string') throw new Error();
        value = parsed;
      } catch {
        unsupported.push(line);
        complex = true;
        continue;
      }
    } else if (value.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(value)) {
        unsupported.push(line);
        complex = true;
        continue;
      }
      value = value.slice(1, -1).replace(/''/g, "'");
    } else if (
      !value ||
      /^[[{>|&*!%@`]/.test(value) ||
      /\s#|:\s/.test(value) ||
      /^(?:null|true|false|~|[-+]?[0-9]+(?:\.[0-9]+)?)$/i.test(value)
    ) {
      unsupported.push(line);
      complex = true;
      continue;
    }
    metadata[key] = value;
    if (
      ![
        'name',
        'description',
        'license',
        'compatibility',
        'version',
        'author',
        'display_name',
        'description_zh',
      ].includes(key)
    )
      unsupported.push(line);
  }
  if (!metadata.name?.trim() || !metadata.description?.trim())
    throw new Error('REQUIRED_FIELD_UNSUPPORTED_OR_MISSING');
  const offsets = [...text.matchAll(/\r\n|\n|\r/g)];
  const bodyOffset = offsets[end] ? offsets[end].index! + offsets[end][0].length : text.length;
  return {
    metadata,
    rawFrontmatter,
    unsupported,
    toolDeclarations,
    complex,
    body: text.slice(bodyOffset),
    bodyLine: end + 2,
  };
}
function platform(path: string, meta: Record<string, string>): string {
  for (const [marker, label] of [
    ['.claude', 'claude'],
    ['.cursor', 'cursor'],
    ['.gemini', 'gemini'],
    ['.codex', 'codex'],
    ['.agents', 'agent-skills'],
    ['.workbuddy', 'workbuddy'],
  ]) {
    if (path.split('/').includes(marker)) return label;
  }
  return meta.display_name || meta.description_zh ? 'workbuddy' : 'agent-skills';
}
function duplicateHints(candidate: SkillCandidate, others: PriorCandidate[]): DuplicateHint[] {
  const hints: DuplicateHint[] = [];
  for (const other of others) {
    if (other.kind !== candidate.kind) continue;
    let relation: DuplicateHint['relation'] | undefined;
    if (other.rawSha256 === candidate.rawSha256) relation = 'exact-raw';
    else if (other.normalizedSha256 === candidate.normalizedSha256) relation = 'exact-normalized';
    else if (
      other.name.normalize('NFC').toLowerCase() === candidate.name.normalize('NFC').toLowerCase()
    )
      relation = 'same-name';
    else if (candidate.similaritySha256 && other.similaritySha256 === candidate.similaritySha256)
      relation = 'similar';
    if (relation) hints.push({ target: other.id, relation, action: 'review' });
  }
  return hints;
}

/** 单次预览不读取路径、不执行工具，也不产生保存或权限。 */
export function previewSkillImport(
  input: unknown,
  hashing: SkillPreviewHashPort,
): SkillPreviewResult {
  const digest = (data: Uint8Array) => hashing.createSha256().update(data).digestHex();
  try {
    if (!isRecord(input)) throw new Error('INVALID_INPUT');
    if (input.cancelled === true) return { status: 'cancelled' };
    if (input.cancelled !== undefined && input.cancelled !== false)
      throw new Error('INVALID_INPUT');
    const files = checkedFiles(input.files).sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    const prior = checkedPrior(input.priorCandidates);
    if (
      input.priorManifestSha256 !== undefined &&
      (!Array.isArray(input.priorManifestSha256) ||
        input.priorManifestSha256.length > MAX_PRIOR ||
        input.priorManifestSha256.some(
          (h: unknown) => typeof h !== 'string' || !/^[a-f0-9]{64}$/.test(h),
        ))
    )
      throw new Error('INVALID_PRIOR');
    const priorManifests = (input.priorManifestSha256 ?? []) as string[];
    const skillFiles = files.filter((f) => f.path.split('/').at(-1) === 'SKILL.md');
    if (!skillFiles.length) throw new Error('SKILL_NOT_FOUND');
    if (
      skillFiles.some((f) =>
        f.path
          .toLowerCase()
          .split('/')
          .some((p) => p === 'scripts' || p === 'hooks'),
      )
    )
      throw new Error('SKILL_IN_QUARANTINE');
    const parsed = skillFiles.map((file) => ({
      file,
      root: file.path.split('/').slice(0, -1).join('/'),
      ...parseSkill(file.bytes),
    }));
    const records: SkillFileRecord[] = [];
    const candidates: SkillCandidate[] = [];
    const warnings: string[] = [];
    let comparisons = 0;
    let hintCount = 0;
    const sourceHashes = new Map<string, string>();
    const add = (
      kind: CandidateKind,
      file: SkillInputFile,
      text: string,
      sourceStartLine: number,
      owner: (typeof parsed)[number],
    ) => {
      if (!text.trim()) return;
      if (candidates.length >= MAX_CANDIDATES) throw new Error('CANDIDATE_LIMIT_EXCEEDED');
      comparisons += prior.length + candidates.length;
      if (comparisons > MAX_COMPARISONS) throw new Error('COMPARISON_LIMIT_EXCEEDED');
      let sourceSha256 = sourceHashes.get(file.path);
      if (!sourceSha256) {
        sourceSha256 = digest(file.bytes);
        sourceHashes.set(file.path, sourceSha256);
      }
      const normalizedText = normalized(text);
      const similaritySha256 =
        normalizedText.length >= 40 ? digest(encoder.encode(normalizedText.slice(0, 40))) : null;
      const candidate: SkillCandidate = {
        id: `${file.path}#${kind}${kind === 'rule' ? `:${sourceStartLine}` : ''}`,
        kind,
        name: kind === 'method' ? owner.metadata.name : file.path.split('/').at(-1)!,
        sourcePath: file.path,
        skillPath: owner.file.path,
        sourceVersion: owner.metadata.version ?? null,
        sourceLicense: owner.metadata.license ?? null,
        sourceSha256,
        rawSha256: digest(encoder.encode(text)),
        normalizedSha256: digest(encoder.encode(normalizedText)),
        similaritySha256,
        sourceStartLine,
        text,
        reviewRequired: true,
        duplicates: [],
      };
      candidate.duplicates = duplicateHints(candidate, [...prior, ...candidates]);
      hintCount += candidate.duplicates.length;
      if (hintCount > MAX_HINTS) throw new Error('HINT_LIMIT_EXCEEDED');
      candidates.push(candidate);
    };
    for (const entry of parsed) {
      if (!entry.metadata.license) warnings.push(`${entry.file.path}: license unverified`);
      if (entry.complex)
        warnings.push(`${entry.file.path}: complex frontmatter unsupported; candidates withheld`);
      else add('method', entry.file, entry.body, entry.bodyLine, entry);
    }
    for (const file of files) {
      const owner = parsed
        .filter((p) => !p.root || file.path.startsWith(`${p.root}/`))
        .sort((a, b) => b.root.length - a.root.length)[0];
      let classification: SkillFileRecord['classification'] = 'unsupported';
      if (skillFiles.includes(file)) classification = 'skill';
      else if (owner) {
        const relative = owner.root ? file.path.slice(owner.root.length + 1) : file.path;
        const segments = relative.toLowerCase().split('/');
        if (
          segments.some((part) => part === 'scripts' || part === 'hooks') ||
          /\.(sh|bash|zsh|py|js|mjs|cjs|ts|exe|dll|dylib|so|bat|cmd|ps1)$/i.test(relative)
        )
          classification = 'quarantined';
        else if (!owner.complex && /\.(md|txt)$/i.test(relative)) {
          let kind: CandidateKind | undefined;
          if (segments[0] === 'templates') kind = 'template';
          else if (segments[0] === 'references') kind = 'reference';
          if (kind) {
            const content = decode(file.bytes);
            add(kind, file, content, 1, owner);
            if (kind === 'reference') {
              const lines = content.split(/\r\n|\n|\r/);
              lines.forEach((line, index) => {
                if (/^\s*[-*] \[ \]/.test(line)) add('rule', file, line, index + 1, owner);
              });
            }
            classification = 'candidate';
          }
        }
      }
      if (classification === 'unsupported') warnings.push(`${file.path}: unsupported file`);
      records.push({
        path: file.path,
        sha256: digest(file.bytes),
        bytes: file.bytes.byteLength,
        classification,
      });
    }
    const manifestSha256 = manifest(files, hashing);
    return {
      status: 'preview',
      converterVersion: 'dev1923-preview-1',
      manifestSha256,
      exactManifestMatches: priorManifests.filter((h) => h === manifestSha256),
      files: records,
      skills: parsed.map((p) => ({
        path: p.file.path,
        sourceSha256: digest(p.file.bytes),
        platform: platform(p.file.path, p.metadata),
        name: p.metadata.name,
        description: p.metadata.description,
        license: p.metadata.license ?? null,
        metadata: p.metadata,
        rawFrontmatter: p.rawFrontmatter,
        toolDeclarations: p.toolDeclarations,
        unsupported: p.unsupported,
      })),
      candidates,
      warnings,
    };
  } catch (error) {
    return { status: 'rejected', code: error instanceof Error ? error.message : 'INVALID_INPUT' };
  }
}
