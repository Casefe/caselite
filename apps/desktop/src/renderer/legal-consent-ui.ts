import type {
  LegalBundle,
  LegalConsentRequest,
  LegalConsentResponse,
} from '../preload/caselite-api';

type LegalApi = { execute(input: LegalConsentRequest): Promise<LegalConsentResponse> };

export function mountLegalConsent(document: Document, api: LegalApi) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = get<HTMLDivElement>('legal-document');
  const mark = get<HTMLButtonElement>('legal-mark-read');
  const confirm = get<HTMLInputElement>('legal-confirm');
  const accept = get<HTMLButtonElement>('legal-accept');
  const decline = get<HTMLButtonElement>('legal-decline');
  const error = get<HTMLParagraphElement>('legal-error');
  const retry = get<HTMLButtonElement>('legal-retry');
  const hint = get<HTMLSpanElement>('legal-read-hint');
  let bundle: LegalBundle | undefined;
  let selected: 'license' | 'eula' = 'license';
  const reviewed = new Set<string>();
  let busy = false;

  function refresh() {
    const reachedEnd = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 8;
    mark.disabled = !bundle || busy || !reachedEnd || reviewed.has(selected);
    confirm.disabled = !bundle || busy || reviewed.size !== 2;
    accept.disabled = confirm.disabled || !confirm.checked;
    decline.disabled = busy;
    hint.textContent = reviewed.has(selected)
      ? '本份协议已标记为已读'
      : reachedEnd
        ? '已到文末，可确认阅读'
        : '请阅读至文末';
    for (const id of ['license', 'eula'] as const) {
      get(`legal-${id === 'license' ? 'tab-license' : 'tab-eula'}`).setAttribute(
        'aria-selected',
        String(id === selected),
      );
      get(`${id}-status`).textContent = reviewed.has(id) ? '已读' : '待读';
    }
  }

  function render() {
    const doc = bundle?.documents.find(({ id }) => id === selected);
    if (!doc) return;
    // 正文只生成文本和有限语义标签，不解释HTML、链接或任何脚本。
    panel.replaceChildren();
    for (const block of doc.text.trim().split(/\n\s*\n/)) {
      const heading = /^(#{1,2})\s+/.exec(block);
      const node = document.createElement(heading ? (heading[1].length === 1 ? 'h2' : 'h3') : 'p');
      const value = block.replace(/^#{1,2}\s+/, '');
      for (const part of value.split(/(\*\*[^*]+\*\*)/g)) {
        if (part.startsWith('**') && part.endsWith('**')) {
          const strong = document.createElement('strong');
          strong.textContent = part.slice(2, -2);
          node.append(strong);
        } else node.append(document.createTextNode(part));
      }
      panel.append(node);
    }
    panel.setAttribute('aria-labelledby', `legal-tab-${selected}`);
    panel.scrollTop = 0;
    refresh();
  }

  async function read() {
    busy = true;
    error.hidden = true;
    refresh();
    const response = await api.execute({ protocol_version: 1, operation: 'read' });
    busy = false;
    if (response.ok) {
      if (bundle?.document_set_hash !== response.bundle.document_set_hash) {
        reviewed.clear();
        confirm.checked = false;
      }
      bundle = response.bundle;
      retry.hidden = true;
      render();
    } else {
      bundle = undefined;
      reviewed.clear();
      confirm.checked = false;
      panel.textContent = '协议暂时无法加载。请重新读取，或退出后联系 tanhui277@163.com。';
      error.textContent = response.message;
      error.hidden = false;
      retry.hidden = false;
    }
    refresh();
  }

  panel.addEventListener('scroll', refresh);
  document.defaultView?.addEventListener('resize', refresh);
  for (const id of ['license', 'eula'] as const)
    get(`legal-tab-${id}`).addEventListener('click', () => {
      selected = id;
      render();
    });
  mark.addEventListener('click', () => {
    if (mark.disabled) return;
    reviewed.add(selected);
    if (selected === 'license' && !reviewed.has('eula')) selected = 'eula';
    render();
  });
  confirm.addEventListener('change', refresh);
  accept.addEventListener('click', async () => {
    if (!bundle || accept.disabled || busy) return;
    busy = true;
    error.hidden = true;
    refresh();
    const response = await api.execute({
      protocol_version: 1,
      operation: 'accept',
      document_set_hash: bundle.document_set_hash,
      confirmed: true,
      reviewed_documents: ['license', 'eula'],
    });
    busy = false;
    if (!response.ok) {
      error.textContent = response.message;
      error.hidden = false;
      retry.hidden = false;
    }
    refresh();
  });
  decline.addEventListener('click', () => {
    if (!busy) void api.execute({ protocol_version: 1, operation: 'decline' });
  });
  retry.addEventListener('click', () => {
    if (!busy) void read();
  });
  void read();
}
