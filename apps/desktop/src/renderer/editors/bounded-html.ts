// 所有 HTML 入口在 ProseMirror 分配表格网格前执行相同的资源边界。
export function assertBoundedHtml(html: string) {
  if (html.length > 1_000_000) throw new Error('内容过大，请分段导入。');
  // 裸单元格片段会被普通 DOMParser 丢弃，却被 ProseMirror 补齐父表格。
  // 首版拒绝此类片段，防止两个解析上下文不同而漏掉跨度检查。
  const fragment = html.replace(/^(\s*<meta [^>]*>)*/, '');
  const firstTag = /<([a-z][^>\s]+)/i.exec(fragment)?.[1].toLowerCase();
  if (
    firstTag &&
    ['thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col', 'tr', 'td', 'th'].includes(firstTag)
  )
    throw new Error('请复制完整表格后粘贴，暂不支持裸单元格片段。');
  // TableMap 会按跨度分配网格，必须在创建 Editor 之前限制不可信 HTML。
  // 与 ProseMirror 一样按 detached body 片段解析，避免头部标签携带未检查的粘贴上下文。
  const body = document.implementation.createHTMLDocument().body;
  body.innerHTML = fragment;
  let count = 0;
  let hasTable = false;
  function inspect(element: Element, depth: number) {
    if (++count > 10000 || depth > 35) throw new Error('文档结构过于复杂，请核对原件。');
    const slice = element.getAttribute('data-pm-slice');
    if (slice !== null) {
      const bounded = /^(\d{1,2}) (\d{1,2})(?: -(\d{1,2}))? \[\]$/.exec(slice);
      if (!bounded || bounded.slice(1).some((value) => value !== undefined && Number(value) > 35))
        throw new Error('剪贴板含额外结构上下文，请复制完整表格、段落或使用纯文本。');
    }
    for (const [attribute, limit] of [
      ['colspan', 100],
      ['rowspan', 200],
    ] as const) {
      const raw = element.getAttribute(attribute);
      if (raw !== null && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > limit))
        throw new Error('合并表格跨度超出支持范围，请核对原件。');
    }
    if (element.tagName === 'TD' || element.tagName === 'TH') {
      const colwidth = element.getAttribute('colwidth');
      const row = element.parentElement;
      const index = row ? [...row.children].indexOf(element) : -1;
      const fallback = element
        .closest('table')
        ?.querySelectorAll('colgroup > col')
        [index]?.getAttribute('width');
      const widths = colwidth ? colwidth.split(',') : fallback ? [fallback] : [];
      if (
        widths.length &&
        (widths.length !== Number(element.getAttribute('colspan') ?? 1) ||
          widths.some((width) => !/^\d+$/.test(width) || Number(width) > 10000))
      )
        throw new Error('表格列宽超出支持范围，请核对原件。');
    }
    if (element.tagName === 'TABLE' && element.querySelectorAll('tr').length > 200)
      throw new Error('表格超过 200 行，请核对原件。');
    if (
      element.tagName === 'TR' &&
      [...element.children].reduce((n, cell) => n + Number(cell.getAttribute('colspan') ?? 1), 0) >
        100
    )
      throw new Error('表格超过 100 列，请核对原件。');
    for (const child of element.children) inspect(child, depth + 1);
    if (element.tagName === 'TABLE') {
      hasTable = true;
      const rows = [...(element as HTMLTableElement).rows];
      const grid: boolean[][] = rows.map(() => []);
      let width = 0;
      for (const [y, row] of rows.entries()) {
        let x = 0;
        for (const cell of row.cells) {
          while (grid[y][x]) x++;
          if (x + cell.colSpan > 100 || y + cell.rowSpan > rows.length)
            throw new Error('表格跨度越界，请核对原件。');
          for (let dy = 0; dy < cell.rowSpan; dy++)
            for (let dx = 0; dx < cell.colSpan; dx++) {
              if (grid[y + dy][x + dx]) throw new Error('表格单元格重叠，请核对原件。');
              grid[y + dy][x + dx] = true;
            }
          x += cell.colSpan;
          width = Math.max(width, x);
        }
      }
      if (
        !width ||
        grid.some(
          (row) =>
            row.length !== width || Array.from({ length: width }, (_, x) => row[x]).some((v) => !v),
        )
      )
        throw new Error('表格不完整，请核对原件。');
    }
  }
  inspect(body, 0);
  return hasTable;
}
