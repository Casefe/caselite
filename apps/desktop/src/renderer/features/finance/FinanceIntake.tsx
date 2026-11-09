import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Material } from '../../../preload/caselite-api';
import type { FinanceCandidate as Candidate, FinancePrefill } from './types';
import type { FinanceManagementController } from './useFinanceManagement';
import { formatCents } from './money';
const PdfReader = lazy(() => import('../../ui/PdfReader'));
const DocxReader = lazy(() =>
  import('../../ui/DocxOriginalReader').then((module) => ({ default: module.DocxOriginalReader })),
);
type PendingMaterial = { scope: string; token: string; photo?: Uint8Array };
const kinds = {
  contract: '收费约定',
  payment: '客户回款',
  invoice: '已开发票',
  expense: '支出 / 垫付',
  unknown: '待选择类型',
};
function Origin({ candidate, edited = false }: { candidate: Candidate; edited?: boolean }) {
  const [reader, setReader] = useState<{ bytes: Uint8Array; name: string; material: Material }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    setError('');
    try {
      const result = await window.caselite.material({
        protocol_version: 1,
        operation: 'read_project',
        project_id: candidate.project_id,
        source_id: candidate.source_id,
      });
      if (!result.ok) throw Error(result.message);
      const source = result.materials.find((row) => row.id === candidate.source_id);
      if (
        !source ||
        !result.data ||
        source.asset_version_id !== candidate.asset_version_id ||
        source.sha256 !== candidate.sha256
      )
        throw Error('来源版本或项目归属已变化，原引用保留，请核对材料。');
      setReader({ bytes: result.data, name: candidate.name, material: source });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="finance-source-reference">
      <summary>
        来源：{candidate.name} · 第 {candidate.page} 页{edited ? ' · 已核对修正' : ''}
      </summary>
      <blockquote>{candidate.quote}</blockquote>
      <button type="button" disabled={busy} onClick={() => void open()}>
        查看原件
      </button>
      {error && <p role="alert">{error}</p>}
      {reader && (
        <Suspense fallback={<p>正在打开原件…</p>}>
          {/\.docx$/i.test(reader.name) ? (
            <DocxReader
              name={reader.name}
              material={{
                ...reader.material,
                derivation_id: candidate.derivation_id,
                pages: [
                  {
                    page: candidate.page,
                    text: candidate.quote,
                    origin: 'docx_text',
                    blocks: [],
                    width: 600,
                    height: 800,
                    rotation: 0,
                    docx_review: reader.material.pages.find((row) => row.page === candidate.page)
                      ?.docx_review,
                  },
                ],
              }}
              onClose={() => setReader(undefined)}
              onSaveOriginal={() =>
                void window.caselite.material({
                  protocol_version: 1,
                  operation: 'save_project_original',
                  project_id: candidate.project_id,
                  source_id: candidate.source_id,
                })
              }
            >
              <p>以下只展示本条候选引用段落，请对照原件副本核验。</p>
            </DocxReader>
          ) : (
            <PdfReader
              {...reader}
              textPages={[
                {
                  page: candidate.page,
                  text: candidate.quote,
                  origin: 'ocr_candidate',
                  blocks: [],
                  width: 600,
                  height: 800,
                  rotation: 0,
                },
              ]}
              initialWidth={240}
              initialPage={candidate.page}
              onClose={() => setReader(undefined)}
            />
          )}
        </Suspense>
      )}
    </details>
  );
}
export function FinanceSourceNote({
  targetId,
  finance,
}: {
  targetId: string;
  finance: FinanceManagementController;
}) {
  const link = finance.state?.sources.find((row) => row.target_id === targetId);
  const candidate = finance.state?.candidates.find((row) => row.id === link?.candidate_id);
  return candidate ? <Origin candidate={candidate} edited={link?.edited} /> : null;
}
function CandidateCard({
  candidate,
  disabled,
  onUse,
  onDismiss,
}: {
  candidate: Candidate;
  disabled: boolean;
  onUse(candidate: Candidate, prefill: FinancePrefill): void;
  onDismiss(): void;
}) {
  const [amount, setAmount] = useState(
    candidate.amount_options.length === 1 ? String(candidate.amount_options[0]) : '',
  );
  const [date, setDate] = useState(
    candidate.date_options.length === 1 ? candidate.date_options[0] : '',
  );
  return (
    <article className="finance-candidate">
      <strong>待确认 · {kinds[candidate.kind]}</strong>
      <Origin candidate={candidate} />
      {candidate.amount_options.length > 1 ? (
        <label>
          候选金额
          <select
            value={amount}
            disabled={disabled}
            onChange={(event) => setAmount(event.target.value)}
          >
            <option value="">多项金额，请选择</option>
            {candidate.amount_options.map((value) => (
              <option key={value} value={value}>
                {formatCents(value)} 元
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>金额：{amount ? formatCents(Number(amount)) + ' 元' : '未识别，请在表单核对填写'}</p>
      )}
      {candidate.date_options.length > 1 ? (
        <label>
          候选日期
          <select
            value={date}
            disabled={disabled}
            onChange={(event) => setDate(event.target.value)}
          >
            <option value="">多项日期，请选择</option>
            {candidate.date_options.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      ) : (
        <p>日期：{date || '未识别，请在表单核对填写'}</p>
      )}
      <div className="finance-fields">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onUse(candidate, {
              amount: amount ? Number(amount) : undefined,
              date: date || undefined,
              reference: candidate.reference ?? undefined,
            })
          }
        >
          填入记账表单
        </button>
        <button type="button" disabled={disabled} onClick={onDismiss}>
          移除候选
        </button>
      </div>
      <small>尚未入账。填入后仍须核对类型、金额、日期与期款。</small>
    </article>
  );
}
async function materialTaskKey(projectId: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('caselite:finance-material-task:' + projectId),
    ),
  );
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-5' +
    hex.slice(13, 16) +
    '-8' +
    hex.slice(17, 20) +
    '-' +
    hex.slice(20, 32)
  );
}
export default function FinanceIntake({
  projectId,
  mode,
  finance,
  disabled,
  onUse,
  onBusy,
}: {
  projectId: string;
  mode: string;
  finance: FinanceManagementController;
  disabled: boolean;
  onUse(candidate: Candidate, prefill: FinancePrefill): void;
  onBusy(value: boolean): void;
}) {
  const [processing, setProcessing] = useState(false);
  const [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [pending, setPendingState] = useState<PendingMaterial>();
  const pendingRef = useRef<PendingMaterial | undefined>(undefined);
  function updatePending(value: PendingMaterial | undefined) {
    pendingRef.current = value;
    setPendingState(value);
  }
  const [sourceId, setSourceId] = useState(''),
    [page, setPage] = useState(1),
    [camera, setCamera] = useState(false);
  const taskRef = useRef<string | undefined>(undefined);
  const workRef = useRef(false),
    cancelRef = useRef(false),
    processRef = useRef<{ scope: string; id: string } | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const video = useRef<HTMLVideoElement>(null);
  const photoFile = useRef<HTMLInputElement>(null);
  const onBusyRef = useRef(onBusy);
  useEffect(() => {
    onBusyRef.current = onBusy;
  }, [onBusy]);
  const sources = useQuery({
    queryKey: ['finance', 'materials', projectId],
    enabled: mode !== 'manual',
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await window.caselite.material({
        protocol_version: 1,
        operation: 'list_project',
        project_id: projectId,
      });
      if (!result.ok) throw Error(result.message);
      return result.materials;
    },
  });
  const selected = sources.data?.find((row) => row.id === sourceId);
  function stopCamera(release = true) {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
    setCamera(false);
    if (taskRef.current)
      void window.caselite.material({
        protocol_version: 1,
        operation: 'camera_revoke',
        scope: taskRef.current,
      });
    if (release) onBusyRef.current(false);
  }
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (stream.current && taskRef.current)
        void window.caselite.material({
          protocol_version: 1,
          operation: 'camera_revoke',
          scope: taskRef.current,
        });
      cancelRef.current = true;
    },
    [],
  );
  async function scope() {
    if (taskRef.current) return taskRef.current;
    const key = await materialTaskKey(projectId);
    const result = await window.caselite.task({
      protocol_version: 1,
      operation: 'create',
      request_id: crypto.randomUUID(),
      idempotency_key: key,
      matter_id: projectId,
      title: '财务材料',
      objective: '本项目的合同、发票、收款凭证与费用材料。',
    });
    if (!result.ok) throw Error(result.message);
    const task = result.tasks[0];
    if (!task || task.matter_id !== projectId || task.document_archived_at)
      throw Error('财务材料任务不可用，请先在项目中恢复该任务。');
    taskRef.current = task.id;
    const staged = await window.caselite.material({
      protocol_version: 1,
      operation: 'list',
      scope: task.id,
    });
    if (!staged.ok) throw new Error(staged.message);
    if (staged.staged) {
      updatePending({ scope: task.id, token: staged.staged.token });
      throw new Error('发现未完成导入，请先核对或取消本次导入。');
    }
    return task.id;
  }
  async function work(action: () => Promise<void>) {
    if (workRef.current || disabled) return;
    workRef.current = true;
    cancelRef.current = false;
    setWorking(true);
    setError('');
    setMessage('');
    onBusyRef.current(true);
    try {
      await action();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      workRef.current = false;
      setWorking(false);
      setProcessing(false);
      processRef.current = undefined;
      if (!stream.current && !pendingRef.current) onBusyRef.current(false);
    }
  }
  async function prepare(source: Material, number: number) {
    if (!source.derivation_id) throw Error('材料尚未完成识别。');
    const success = await finance.submit({
      operation: 'm_prepare_source',
      project_id: projectId,
      source_id: source.id,
      asset_version_id: source.asset_version_id,
      derivation_id: source.derivation_id,
      sha256: source.sha256,
      page: number,
    });
    if (success) setMessage('原件已保存；待确认候选列在下方。重复导入会返回原候选。');
  }
  async function process(source: Material, number: number) {
    const scopeId = source.task_id;
    let current = source;
    processRef.current = { scope: scopeId, id: source.id };
    setProcessing(true);
    async function waitUntilIdle() {
      for (let n = 0; n < 460; n++) {
        if (cancelRef.current) throw Error('已取消识别，原件保留。');
        const result = await window.caselite.material({
          protocol_version: 1,
          operation: 'list',
          scope: scopeId,
        });
        if (!result.ok) throw Error(result.message);
        const found = result.materials.find((row) => row.id === source.id);
        if (!found) throw Error('原件不在原任务中，请核对材料。');
        current = found;
        if (found.status !== 'processing') return;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw Error('本机识别尚未结束，原件保留，可稍后核对原导入。');
    }
    // commit会启动初次文字提取；等待它结束，再决定是否需要OCR，避免正常导入被BUSY打断。
    if (current.status === 'processing') await waitUntilIdle();
    if (
      !['ready', 'needs_ocr'].includes(current.status) ||
      !current.pages.some(
        (row) =>
          row.page === number && row.text.trim() && !['needs_ocr', 'failed'].includes(row.origin),
      )
    ) {
      const start = await window.caselite.material({
        protocol_version: 1,
        operation: 'process',
        scope: scopeId,
        source_id: source.id,
        ocr: true,
      });
      if (!start.ok) throw Error(start.message);
      await waitUntilIdle();
    }
    processRef.current = undefined;
    await sources.refetch();
    setSourceId(current.id);
    setPage(number);
    if (!['ready', 'needs_ocr'].includes(current.status))
      throw Error('原件已保存，本机识别未完成，可重试或手动记账。');
    updatePending(undefined);
    setProcessing(false);
    if (
      !current.pages.some(
        (row) =>
          row.page === number && row.text.trim() && !['needs_ocr', 'failed'].includes(row.origin),
      )
    )
      throw Error('原件已保存，但未识别出本页文字，可核对原件后手动记一笔。');
    if (cancelRef.current) throw new Error('已取消生成候选，原件保留。');
    await prepare(current, number);
  }
  async function finish(scopeId: string, token: string, photo?: Uint8Array) {
    let result = await window.caselite.material({
      protocol_version: 1,
      operation: 'list',
      scope: scopeId,
    });
    if (!result.ok) throw Error(result.message);
    let source = result.materials.find((row) => row.id === token);
    if (!source && !result.staged && photo) {
      const recovered = await window.caselite.material({
        protocol_version: 1,
        operation: 'capture_photo',
        scope: scopeId,
        token,
        bytes: new Uint8Array(photo),
      });
      if (!recovered.ok) throw new Error(recovered.message);
      result = recovered;
      source = result.materials.find((row) => row.id === token);
    }
    if (!source && result.staged?.token === token) {
      result = await window.caselite.material({
        protocol_version: 1,
        operation: 'commit',
        scope: scopeId,
        token,
      });
      if (!result.ok) throw Error(result.message);
      source = result.materials.find((row) => row.id === token);
    }
    if (!source) throw Error('无法核对原导入。请保留当前材料身份，重新核对后再导入。');
    await process(source, 1);
  }
  async function pick() {
    await work(async () => {
      const scopeId = await scope();
      const result = await window.caselite.pickPdf(scopeId);
      if (!result.ok) {
        const recovered = await window.caselite.material({
          protocol_version: 1,
          operation: 'list',
          scope: scopeId,
        });
        if (recovered.ok && recovered.staged)
          updatePending({ scope: scopeId, token: recovered.staged.token });
        throw Error(result.message);
      }
      if (!result.staged) return;
      updatePending({ scope: scopeId, token: result.staged.token });
      await finish(scopeId, result.staged.token);
    });
  }
  async function startCamera() {
    await work(async () => {
      const scopeId = await scope();
      const permission = await window.caselite.material({
        protocol_version: 1,
        operation: 'camera_permission',
        scope: scopeId,
      });
      if (!permission.ok) throw Error(permission.message);
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 } },
        });
        setCamera(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (video.current) {
          video.current.srcObject = stream.current;
          await video.current.play();
        }
      } catch {
        stopCamera();
        throw Error('摄像头不可用或未获许可，可以选择拍好的照片。');
      }
    });
  }
  async function capture() {
    await work(async () => {
      const player = video.current;
      if (!player || !player.videoWidth || !player.videoHeight)
        throw Error('画面尚未就绪，请稍后拍摄。');
      const canvas = document.createElement('canvas');
      canvas.width = player.videoWidth;
      canvas.height = player.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw Error('无法生成照片。');
      context.drawImage(player, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      );
      if (!blob || blob.size > 8 * 1024 * 1024) throw Error('照片过大，请选择较小照片。');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      stopCamera(false);
      const scopeId = await scope();
      const ticket = await window.caselite.material({
        protocol_version: 1,
        operation: 'photo_ticket',
        scope: scopeId,
      });
      if (!ticket.ok || !ticket.capture_token)
        throw new Error(ticket.ok ? '无法准备照片暂存。' : ticket.message);
      const token = ticket.capture_token;
      updatePending({ scope: scopeId, token, photo: bytes });
      const result = await window.caselite.material({
        protocol_version: 1,
        operation: 'capture_photo',
        scope: scopeId,
        token,
        bytes,
      });
      if (!result.ok) throw Error(result.message);
      await finish(scopeId, token);
    });
  }
  const blocked = disabled || working || camera || !!pending;
  return (
    <section hidden={mode === 'manual'} className="finance-intake" aria-label="材料生成待确认记录">
      <p className="finance-muted">
        原件保存在项目的「财务材料」任务；识别在本机进行，确认前不入账。
      </p>
      {mode === 'photo' ? (
        <>
          <button type="button" disabled={blocked} onClick={() => void startCamera()}>
            打开摄像头
          </button>
          <button type="button" disabled={blocked} onClick={() => photoFile.current?.click()}>
            选择拍好的照片
          </button>
          <p className="finance-muted">支持JPEG/PNG，照片不超过900万像素。</p>
        </>
      ) : (
        <button type="button" disabled={blocked} onClick={() => void pick()}>
          选择合同、发票或收款文件
        </button>
      )}
      <input
        ref={photoFile}
        type="file"
        accept="image/png,image/jpeg"
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file)
            void work(async () => {
              const scopeId = await scope();
              const result = await window.caselite.dropPdf(file, scopeId);
              if (!result.ok) {
                const recovered = await window.caselite.material({
                  protocol_version: 1,
                  operation: 'list',
                  scope: scopeId,
                });
                if (recovered.ok && recovered.staged)
                  updatePending({ scope: scopeId, token: recovered.staged.token });
                throw new Error(result.message);
              }
              if (!result.staged) throw new Error('未取得照片原件。');
              updatePending({ scope: scopeId, token: result.staged.token });
              await finish(scopeId, result.staged.token);
            });
        }}
      />
      <div hidden={!camera}>
        <video ref={video} muted playsInline />
        <button type="button" disabled={working || disabled} onClick={() => void capture()}>
          拍摄并识别
        </button>
        <button type="button" disabled={working} onClick={() => stopCamera()}>
          取消拍照
        </button>
      </div>
      {working && <p role="status">正在保存原件并进行本机识别…</p>}
      {working && processing && (
        <button
          type="button"
          onClick={() => {
            cancelRef.current = true;
            const current = processRef.current;
            if (current)
              void window.caselite.material({
                protocol_version: 1,
                operation: 'cancel',
                scope: current.scope,
                source_id: current.id,
              });
          }}
        >
          取消本次识别
        </button>
      )}
      {pending && !working && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => void work(() => finish(pending.scope, pending.token, pending.photo))}
        >
          核对原导入
        </button>
      )}
      {pending && !working && (
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void work(async () => {
              const read = await window.caselite.material({
                protocol_version: 1,
                operation: 'list',
                scope: pending.scope,
              });
              if (!read.ok) throw new Error(read.message);
              if (read.staged?.token === pending.token) {
                const discarded = await window.caselite.material({
                  protocol_version: 1,
                  operation: 'discard',
                  scope: pending.scope,
                  token: pending.token,
                });
                if (!discarded.ok) throw new Error(discarded.message);
              }
              updatePending(undefined);
              setMessage('已结束本次导入；已保存的原件继续保留。');
            })
          }
        >
          结束本次导入
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <details>
        <summary>从项目已有材料生成</summary>
        {sources.error && <p role="alert">{sources.error.message}</p>}
        <label>
          项目材料
          <select
            value={sourceId}
            disabled={blocked}
            onChange={(event) => {
              setSourceId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">选择材料</option>
            {sources.data?.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <label>
            来源页 / 提取段
            <select
              value={page}
              disabled={blocked}
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {Array.from({ length: selected.page_count }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={!selected || blocked}
          onClick={() => selected && void work(() => process(selected, page))}
        >
          本机识别并生成候选
        </button>
        <button type="button" disabled={blocked} onClick={() => void sources.refetch()}>
          刷新材料
        </button>
      </details>
      {finance.state?.candidates
        .filter((row) => row.project_id === projectId && row.status === 'pending')
        .map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            disabled={blocked}
            onUse={onUse}
            onDismiss={() =>
              void finance.submit({
                operation: 'm_dismiss_candidate',
                project_id: projectId,
                candidate_id: candidate.id,
                note: '用户移除本次候选，原件保留',
              })
            }
          />
        ))}
    </section>
  );
}
