import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  financeCandidateSchema,
  financeSourceLinkSchema,
  type FinanceCandidate,
  type FinanceSourceClaim,
  type FinanceSourceReference,
} from '@caselite/contracts';
import { createMaterialStore } from './material-store';
type Suggestions = Pick<FinanceCandidate, 'kind' | 'amount_options' | 'date_options' | 'reference'>;
export function createFinanceSources(db: Database.Database, workspace: string) {
  const materials = createMaterialStore(db, workspace);
  const candidates = () =>
    (
      db
        .prepare(
          'SELECT id,value,status,confirmed_target_id,created_at FROM finance_candidates WHERE workspace_id=? ORDER BY rowid',
        )
        .all(workspace) as {
        id: string;
        value: string;
        status: string;
        confirmed_target_id: string | null;
        created_at: string;
      }[]
    ).map((row) =>
      financeCandidateSchema.parse({
        ...JSON.parse(row.value),
        id: row.id,
        status: row.status,
        confirmed_target_id: row.confirmed_target_id,
        created_at: row.created_at,
      }),
    );
  const links = () =>
    db
      .prepare(
        'SELECT candidate_id,project_id,operation,target_id,edited,created_at FROM finance_source_links WHERE workspace_id=? ORDER BY rowid',
      )
      .all(workspace)
      .map((row) =>
        financeSourceLinkSchema.parse({
          ...(row as object),
          edited: !!(row as { edited: number }).edited,
        }),
      );
  function fixed(ref: FinanceSourceReference) {
    if (!materials.projectSources(ref.project_id)?.some((row) => row.id === ref.source_id))
      throw new Error('材料不属于本项目，请重新核对。');
    const source = materials.fixed?.(ref.source_id, ref.derivation_id);
    if (!source || source.asset_version_id !== ref.asset_version_id || source.sha256 !== ref.sha256)
      throw new Error('材料固定版本已变化，请重新读取。');
    if (!['ready', 'needs_ocr'].includes(source.status))
      throw new Error('来源尚未完成识别，请稍后重试。');
    const page = source.pages.find((row) => row.page === ref.page);
    if (!page || !page.text.trim() || ['failed', 'needs_ocr'].includes(page.origin))
      throw new Error('这一页尚无可核对文字，请先完成本机识别。');
    return { source, page };
  }
  function candidate(id: string) {
    const row = candidates().find((row) => row.id === id);
    if (!row) throw new Error('待确认记录不存在。');
    return row;
  }
  function immutable(row: FinanceCandidate) {
    const { status, confirmed_target_id, ...value } = row;
    void status;
    void confirmed_target_id;
    return value;
  }
  function check(projectId: string, claim: FinanceSourceClaim) {
    const row = candidate(claim.candidate_id);
    if (row.project_id !== projectId || row.status !== 'pending')
      throw new Error('候选已处理或不属于本项目，不可重复记账。');
    const current = fixed(row);
    if (current.page.text.slice(0, 8000) !== row.quote)
      throw new Error('来源文字与候选不一致，请重新核对。');
    return row;
  }
  return {
    candidates,
    links,
    candidate,
    immutable,
    prepare(ref: FinanceSourceReference, parse: (text: string) => Suggestions, now: string) {
      const { source, page } = fixed(ref);
      const hex = createHash('sha256')
        .update(workspace + '\0' + ref.project_id + '\0' + ref.sha256 + '\0' + ref.page)
        .digest('hex');
      const id =
        hex.slice(0, 8) +
        '-' +
        hex.slice(8, 12) +
        '-5' +
        hex.slice(13, 16) +
        '-8' +
        hex.slice(17, 20) +
        '-' +
        hex.slice(20, 32);
      const old = candidates().find((row) => row.id === id);
      if (old) return old;
      const quote = page.text.slice(0, 8000);
      const row = financeCandidateSchema.parse({
        project_id: ref.project_id,
        source_id: ref.source_id,
        asset_version_id: ref.asset_version_id,
        derivation_id: ref.derivation_id,
        sha256: ref.sha256,
        page: ref.page,
        id,
        name: source.name,
        quote,
        ...parse(quote),
        status: 'pending',
        confirmed_target_id: null,
        created_at: now,
      });
      db.prepare(
        'INSERT INTO finance_candidates(id,workspace_id,project_id,value,created_at) VALUES(?,?,?,?,?)',
      ).run(id, workspace, ref.project_id, JSON.stringify(immutable(row)), now);
      const saved = candidate(id);
      if (JSON.stringify(saved) !== JSON.stringify(row)) throw new Error('材料候选未正确落盘。');
      return row;
    },
    check,
    confirm(
      projectId: string,
      claim: FinanceSourceClaim,
      operation: string,
      targetId: string,
      input: {
        amount_cents?: number;
        occurred_on?: string;
        number?: string;
        invoice_number?: string;
      },
      now: string,
    ) {
      const row = check(projectId, claim);
      const recordKind = (
        {
          register_contract: 'contract',
          record_payment: 'payment',
          m_record_invoice: 'invoice',
          m_red_invoice: 'invoice',
          m_record_expense: 'expense',
        } as Record<string, string>
      )[operation];
      const reference = input.number ?? input.invoice_number;
      const edited =
        (input.amount_cents !== undefined && !row.amount_options.includes(input.amount_cents)) ||
        (input.occurred_on !== undefined && !row.date_options.includes(input.occurred_on)) ||
        (reference !== undefined && row.reference !== null && reference !== row.reference) ||
        row.kind !== recordKind;

      db.prepare(
        'INSERT INTO finance_source_links(candidate_id,workspace_id,project_id,operation,target_id,edited,created_at) VALUES(?,?,?,?,?,?,?)',
      ).run(row.id, workspace, projectId, operation, targetId, Number(edited), now);
      db.prepare(
        "UPDATE finance_candidates SET status='confirmed',confirmed_target_id=? WHERE id=? AND workspace_id=? AND status='pending'",
      ).run(targetId, row.id, workspace);
      this.verify(row.id, projectId, operation, targetId);
    },
    verify(id: string, projectId: string, operation: string, targetId: string) {
      const row = candidate(id);
      const link = links().find((row) => row.candidate_id === id);
      if (
        row.project_id !== projectId ||
        row.status !== 'confirmed' ||
        row.confirmed_target_id !== targetId ||
        !link ||
        link.project_id !== projectId ||
        link.operation !== operation ||
        link.target_id !== targetId
      )
        throw new Error('财务来源确认凭据不完整。');
      return link;
    },
    forTarget(targetId: string) {
      return links().find((row) => row.target_id === targetId);
    },
    dismiss(projectId: string, id: string) {
      const row = candidate(id);
      if (row.project_id !== projectId || row.status !== 'pending')
        throw new Error('候选不存在或已经处理。');
      db.prepare(
        "UPDATE finance_candidates SET status='dismissed' WHERE id=? AND workspace_id=? AND status='pending'",
      ).run(id, workspace);
      if (candidate(id).status !== 'dismissed') throw new Error('候选移除未落盘。');
    },
  };
}
