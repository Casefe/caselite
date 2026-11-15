import { useEffect, useRef, useState } from 'react';
import type {
  SkillPreview,
  SkillPreviewInput,
  SkillPreviewResult,
} from '../../../preload/caselite-api';
import { FileUploadButton, FileUploadList } from '../../shared/ui/FileUpload';

type SelectedFile = { id: string; file: File; path: string };
const kindLabels = { method: '方法', reference: '参考资料', template: '模板', rule: '规则候选' };
const relationLabels = {
  'exact-raw': '精确内容重复',
  'exact-normalized': '归一化精确重复',
  'same-name': '同名：人工复核',
  similar: '近似：人工复核',
};

export default function SkillsImportPreview({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [compared, setCompared] = useState<Map<string, SkillPreview['candidates'][number]> | null>(
    null,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const previous = useRef<SkillPreview | null>(null);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  function close() {
    generation.current++;
    setOpen(false);
    setBusy(false);
    setFiles([]);
    setPreview(null);
    setCompared(null);
    setError('');
    previous.current = null;
  }
  function changeFiles(next: SelectedFile[]) {
    generation.current++;
    setFiles(next);
    setPreview(null);
    setCompared(null);
    setError('');
    setBusy(false);
  }
  async function run() {
    const api = window.caselite;
    const limits = api.skillsPreviewLimits;
    if (!api.previewSkills || !limits) {
      setError('当前桌面版本尚未提供 Skills 预览，请保留所选文件。');
      return;
    }
    const ticket = ++generation.current;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      if (
        !files.length ||
        files.length > limits.files ||
        files.some(({ file }) => file.size > limits.fileBytes) ||
        files.reduce((n, { file }) => n + file.size, 0) > limits.totalBytes
      )
        throw new Error('所选文件超出数量或大小限制。');
      const readable = files.filter(({ file }) => /\.(md|txt)$/i.test(file.name));
      if (!readable.length) throw new Error('请选择包含 SKILL.md 的文本文件集合。');
      const input: SkillPreviewInput = { files: [] };
      const bytes: SkillPreviewInput['files'][number][] = [];
      // 只读取用户在本次选择器交出的File；相对路径仅为集合内标签，不用于访问本机。
      for (const selected of readable) {
        const data = new Uint8Array(await selected.file.arrayBuffer());
        if (ticket !== generation.current) return;
        bytes.push({ path: selected.path, kind: 'file', bytes: data });
      }
      input.files = bytes;
      // 上次候选使用短索引，避免同一路径在两次预览中碰撞；当前候选ID含#类型，不会与该索引混同。
      const comparedCandidates = new Map(
        (previous.current?.candidates ?? []).map(
          (candidate, index) => [`previous:${index}`, candidate] as const,
        ),
      );
      if (previous.current) {
        input.priorCandidates = Array.from(
          comparedCandidates,
          ([id, { kind, name, rawSha256, normalizedSha256, similaritySha256 }]) => ({
            id,
            kind,
            name,
            rawSha256,
            normalizedSha256,
            similaritySha256,
          }),
        );
        input.priorManifestSha256 = [previous.current.manifestSha256];
      }
      const result: SkillPreviewResult = await api.previewSkills(input);
      if (ticket !== generation.current) return;
      if (result.status === 'preview') {
        setCompared(comparedCandidates);
        setPreview(result);
        previous.current = result;
      } else if (result.status === 'rejected')
        setError(`预览未完成（${result.code}）。所选文件仍保留，可调整路径或重试。`);
      else setError('预览已取消，所选文件仍保留。');
    } catch (cause) {
      if (ticket === generation.current)
        setError(
          cause instanceof Error && cause.message.startsWith('所选')
            ? cause.message
            : '无法读取或预览所选文本。文件仍保留，可重试或重新选择。',
        );
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <details>
        <summary>导入</summary>
        <button type="button" disabled={disabled} onClick={() => setOpen(true)}>
          Skills
        </button>
      </details>
      {open && (
        <dialog
          ref={dialog}
          className="skills-preview-dialog"
          aria-label="Skills 导入预览"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <h2>Skills 导入预览</h2>
          <p>
            仅预览本次所选文本文件集合（.md / .txt），不保存、不执行、不发布。文件夹和 ZIP
            尚未支持。
          </p>
          <p>
            相对路径仅用于识别集合内归属。请保留 SKILL.md；参考资料填
            skill/references/文件名，模板填 skill/templates/文件名。此处不读取该路径。
          </p>
          <FileUploadButton
            disabled={busy}
            onPick={() => picker.current?.click()}
            title="选择本地 Skills 文本文件"
          />
          <input
            ref={picker}
            type="file"
            multiple
            accept=".md,.txt"
            aria-label="选择 Skills 文本文件"
            hidden
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []);
              if (chosen.length)
                changeFiles(
                  chosen.map((file, index) => ({
                    file,
                    id: String(index),
                    path: `skill/${file.name}`,
                  })),
                );
              event.target.value = '';
            }}
          />
          <FileUploadList
            files={files.map(({ id, file }) => ({
              id,
              name: file.name,
              bytes: file.size,
              status: /\.(md|txt)$/i.test(file.name) ? '所选文本，尚未保存' : '不支持，未读取',
            }))}
            disabled={busy}
            onRemove={(id) => changeFiles(files.filter((file) => file.id !== id))}
          />
          {files
            .filter(({ file }) => /\.(md|txt)$/i.test(file.name))
            .map((file) => (
              <label key={file.id}>
                {file.file.name} 的集合相对路径
                <input
                  aria-label={`${file.file.name} 的集合相对路径`}
                  maxLength={4096}
                  value={file.path}
                  disabled={busy}
                  onChange={(event) =>
                    changeFiles(
                      files.map((item) =>
                        item.id === file.id ? { ...item, path: event.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
            ))}
          <p>
            只比较本次集合与本窗口上一次成功预览；不查询生产知识库。精确重复仅提示，近似与同名内容须人工复核。关闭后清除比较记录。
          </p>
          <p>
            未选中的脚本、附件和目录内容未读取或扫描；包完整性未知。非文本脚本不读取，工具声明仅隔离展示，不授予权限。
          </p>
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">正在预览所选文本…</p>}
          <button type="button" disabled={busy || !files.length} onClick={() => void run()}>
            预览所选集合
          </button>
          <button type="button" onClick={close}>
            取消并关闭
          </button>
          {preview && (
            <section aria-label="Skills 预览结果">
              <p>
                本次已读取文本集合 SHA-256：<code>{preview.manifestSha256}</code>
                （不是完整原包或固定来源版本）
              </p>
              {!!preview.exactManifestMatches.length && (
                <p>与上一次预览的已读取文本集合完全相同；没有新增资产。</p>
              )}
              <h3>来源与格式</h3>
              {preview.skills.map((skill) => (
                <article key={skill.path}>
                  <h4>{skill.name}</h4>
                  <p>
                    集合路径：{skill.path} · 格式线索（按所填路径/前言推断）：{skill.platform} ·{' '}
                    {skill.description}
                  </p>
                  <p>许可声明（未核验）：{skill.license ?? '未提供'}</p>
                  <pre>{JSON.stringify(skill.metadata, null, 2)}</pre>
                  <details>
                    <summary>所选原文前言</summary>
                    <pre>{skill.rawFrontmatter}</pre>
                  </details>
                  <h4>隔离的工具声明</h4>
                  <pre>{skill.toolDeclarations.join('\n') || '所选文本中无声明'}</pre>
                  <h4>不支持项</h4>
                  <pre>{skill.unsupported.join('\n') || '所选前言中无不支持项'}</pre>
                </article>
              ))}
              <h3>已读取文件清单</h3>
              <ul>
                {preview.files.map((file) => (
                  <li key={file.path}>
                    {file.path} · {file.classification} · {file.bytes} 字节 · {file.sha256}
                  </li>
                ))}
              </ul>
              <h3>待人工确认的候选</h3>
              {preview.candidates.map((candidate) => (
                <article key={candidate.id}>
                  <h4>
                    {kindLabels[candidate.kind]} · {candidate.name}
                  </h4>
                  <p>
                    {candidate.sourcePath}：{candidate.sourceStartLine} · 版本{' '}
                    {candidate.sourceVersion ?? '未提供'} · 来源 SHA-256 {candidate.sourceSha256}
                  </p>
                  <pre>{candidate.text}</pre>
                  <ul>
                    {candidate.duplicates.map((hint, index) => {
                      const priorTarget = compared?.get(hint.target);
                      const target =
                        priorTarget ?? preview.candidates.find((item) => item.id === hint.target);
                      return (
                        <li key={index}>
                          {relationLabels[hint.relation]} · {priorTarget ? '上次预览' : '本次集合'}{' '}
                          · {target?.sourcePath ?? hint.target}
                          <details>
                            <summary>对照原文（仅人工复核）</summary>
                            <pre>{target?.text ?? '对照文本不可用，请重新选择材料。'}</pre>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                  <p>仅候选；法域、效力和规则含义尚未确认。</p>
                </article>
              ))}
              <h3>警告</h3>
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </section>
          )}
        </dialog>
      )}
    </>
  );
}
