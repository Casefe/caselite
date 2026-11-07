import { createContext, useEffect, useRef, useState } from 'react';
import { agentProviderFor, agentModelLabel, agentModels, providerNames } from './model-labels';
import type { AgentModel, AgentProvider, AgentRequest } from '../../preload/caselite-api';
import { Icon } from './Workspace';
import { ThemeSetting } from './Appearance';

export const ModelSettingsNavigation = createContext<(() => void) | null>(null);
export const settingsGroups = [
  {
    title: '个人',
    items: [
      ['general', '常规'],
      ['account', '账户'],
      ['notifications', '通知'],
      ['workbench', '工作台'],
      ['privacy', '安全'],
    ],
  },
  {
    title: '高级',
    items: [
      ['models', '模型'],
      ['editor', '编辑器'],
      ['drawing', '绘图工具'],
      ['workflows', '工作流'],
      ['skills', 'Skills'],
    ],
  },
  {
    title: '管理',
    items: [
      ['workspace', '工作区'],
      ['teams', '团队'],
      ['members', '成员'],
      ['security', '安全'],
      ['mcp', 'MCP'],
      ['plan', '套餐'],
      ['transfer', '导入导出'],
      ['backups', '备份'],
    ],
  },
] as const;
export type SettingsSection = (typeof settingsGroups)[number]['items'][number][0];

const information: Partial<Record<SettingsSection, readonly [string, string, string][]>> = {
  notifications: [['任务提醒', '在任务中设置提醒，到侧栏「提醒」查看。', '本机提醒']],
  workbench: [['项目与财务', '在工作台侧栏进入项目、任务、知识库和财务。', '工作台']],
  privacy: [
    ['本机保存', '任务、工作稿和导入的材料保存在此设备。', '本地保存'],
    ['向模型发送内容', '文档审阅在点击发送后提交所选段落和本轮问题。', '显式发送'],
    ['文档审阅写回', '确认候选后保存为同一文档的新修订，保留原版本。', '人工确认'],
  ],
  editor: [['文档编辑', '在工作稿中使用富文本编辑器。全局编辑器偏好待开放。', '待开放']],
  drawing: [['绘图工具', '绘图工具设置待接入。', '待接入']],
  workflows: [['工作流', '自定义工作流设置待开放。', '待开放']],
  skills: [['Skills', '技能管理待接入。', '待接入']],
  workspace: [['工作区', '当前使用此设备上的个人工作区。', '本地工作区']],
  teams: [['团队与同步', '跨设备同步与团队协作待开放。', '待开放']],
  members: [['成员管理', '成员邀请和管理待开放。', '待开放']],
  security: [['工作区安全', '团队访问策略和审计设置待开放。', '待开放']],
  mcp: [['MCP 连接', 'MCP 连接管理待接入。', '待接入']],
  plan: [['套餐', '订阅和套餐管理待开放。', '待开放']],
  transfer: [['导入导出', '工作区级导入导出待开放。', '待开放']],
  backups: [['备份与恢复', '备份选择与隔离恢复将在后续版本开放。', '待开放']],
};
const services = [
  {
    id: 'openai',
    name: 'OpenAI',
    mark: 'O',
    kind: '对话模型',
    description: 'AI 起草、对话与任务辅助',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    note: '',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    mark: 'D',
    kind: '对话模型',
    description: '通用对话与推理',
    endpoint: 'https://api.deepseek.com',
    model: '接入时选择具体模型',
    note: '',
  },
  {
    id: 'glm',
    name: providerNames.glm,
    mark: 'G',
    kind: '对话模型',
    description: '智谱开放平台',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7-flash',
    note: '',
  },
  {
    id: 'kimi',
    name: providerNames.kimi,
    mark: 'K',
    kind: '对话模型',
    description: '月之暗面开放平台',
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    note: '',
  },
  {
    id: 'siliconflow',
    name: providerNames.siliconflow,
    mark: '硅',
    kind: '对话模型',
    description: '硅基流动开放平台',
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
    note: '',
  },
  {
    id: 'mineru',
    name: 'MinerU OCR',
    mark: 'M',
    kind: '文档识别',
    description: 'PDF 与扫描件解析',
    endpoint: 'https://mineru.net/api/v4',
    model: '文档解析服务',
    note: '云端 OCR 尚未接入。启用前需选择文件并确认上传范围，不会作为对话模型使用。',
  },
  {
    id: 'yuandian',
    name: '元典',
    mark: '元',
    kind: '法律检索',
    description: '法规、案例与专业法律数据',
    endpoint: 'https://open.chineselaw.com/open',
    model: '元典开放平台',
    note: '法律数据服务尚未接入。当前按元典开放平台设计，后续使用前确认查询内容与授权范围。',
  },
] as const;
const isProvider = (id: (typeof services)[number]['id']): id is AgentProvider =>
  id in providerNames;

export default function SettingsView({
  section,
  onSection,
  onBack,
}: {
  section: SettingsSection;
  onSection(section: SettingsSection): void;
  onBack(): void;
}) {
  const group = settingsGroups.find(({ items }) => items.some(([id]) => id === section))!;
  const label = group.items.find(([id]) => id === section)![1];
  return (
    <section className="settings-center" aria-label="设置中心">
      <aside className="settings-navigation">
        <div className="settings-nav-title">
          <Icon name="settings" size={17} />
          <h1>设置</h1>
        </div>
        <nav aria-label="设置分类">
          {settingsGroups.map(({ title, items }) => (
            <div className="settings-nav-group" key={title} role="group" aria-label={title}>
              <span>{title}</span>
              {items.map(([id, name]) => (
                <button
                  key={id}
                  aria-current={section === id ? 'page' : undefined}
                  onClick={() => onSection(id)}
                >
                  {name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="settings-back" onClick={onBack}>
          <Icon name="back" size={14} />
          返回工作区
        </button>
        <p>
          个人本地工作区
          <br />
          无需登录即可使用
        </p>
      </aside>
      <div className="settings-content">
        <header className="settings-heading">
          <span>
            设置 / {group.title} / {label}
          </span>
          <span>仅此设备</span>
        </header>
        <div className="settings-page">
          <h2>{label}</h2>
          {section === 'models' && <ModelSettings />}
          {section === 'general' && <ThemeSetting />}
          {section === 'account' && (
            <SettingRow
              title="个人本地工作区"
              description="当前在此设备使用 CaseLite，本地功能无需登录。"
              value="本地使用"
            />
          )}
          {information[section]?.map(([title, description, value]) => (
            <SettingRow key={title} title={title} description={description} value={value} />
          ))}
        </div>
      </div>
    </section>
  );
}
function SettingRow({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <div className="setting-row">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <span className="settings-pill">{value}</span>
    </div>
  );
}
function ModelSettings() {
  const [selected, setSelected] = useState<(typeof services)[number]['id']>('openai');
  const [providers, setProviders] = useState<Partial<Record<AgentProvider, boolean>> | null>(null);
  const [credentialErrors, setCredentialErrors] = useState<
    Partial<Record<AgentProvider, 'UNAVAILABLE'>>
  >({});
  const [defaultModel, setDefaultModel] = useState<AgentModel>('gpt-4.1-mini');
  const [selectedModel, setSelectedModel] = useState<AgentModel>('gpt-4.1-mini');
  const [key, setKey] = useState('');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(true);
  const service = services.find((item) => item.id === selected)!;
  const available = isProvider(service.id);
  const provider = service.id as AgentProvider;
  const configured = available ? (providers?.[provider] ?? null) : null;
  const modelOptions = agentModels.filter((model) => agentProviderFor(model) === service.id);
  const trimmedKey = key.trim();
  const validKey =
    trimmedKey.length <= 512 &&
    (provider === 'openai' || provider === 'deepseek'
      ? /^sk-[A-Za-z0-9_-]{8,}$/.test(trimmedKey)
      : /^[A-Za-z0-9._-]{10,}$/.test(trimmedKey));
  async function execute(request: AgentRequest) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    setNotice('');
    if (request.operation !== 'profile' && request.operation !== 'refresh_credentials') setKey('');
    try {
      const result = await window.caselite.agent(request);
      if (!mounted.current) return;
      if (result.ok) {
        setProviders(result.providers);
        setCredentialErrors(result.credential_errors ?? {});
        setDefaultModel(result.model);
        setConfirmDelete(false);
        if (request.operation === 'configure')
          setNotice('密钥已加密保存到此设备。尚未验证服务连接。');
        if (request.operation === 'select_model')
          setNotice(`默认模型已保存：${agentModelLabel(result.model)}。`);
        if (request.operation === 'clear_key') setNotice('已删除本机密钥，人工编辑不受影响。');
        if (request.operation === 'refresh_credentials')
          setNotice('已重新读取系统凭据状态，未发起模型请求。');
      } else {
        setError(result.message);
        setProviders(null);
      }
    } catch {
      if (mounted.current) {
        setProviders(null);
        setError('无法读取或确认模型配置，请重新读取状态后再操作。');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void window.caselite
      .agent({ protocol_version: 1, operation: 'profile' })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setProviders(result.providers);
          setCredentialErrors(result.credential_errors ?? {});
          setDefaultModel(result.model);
        } else setError(result.message);
      })
      .catch(() => {
        if (!cancelled) setError('无法读取模型配置，请重试。');
      })
      .finally(() => {
        if (!cancelled) {
          inFlight.current = false;
          setPending(false);
        }
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);
  return (
    <>
      <p className="settings-lead">统一管理对话模型、文档识别与法律检索服务。</p>
      <div className="model-catalog">
        <div className="provider-list" aria-label="模型与服务">
          {services.map((item) => (
            <button
              key={item.id}
              data-provider={item.id}
              aria-pressed={selected === item.id}
              disabled={pending}
              onClick={() => {
                setSelected(item.id);
                setSelectedModel(
                  agentProviderFor(defaultModel) === item.id
                    ? defaultModel
                    : (agentModels.find((model) => agentProviderFor(model) === item.id) ??
                        defaultModel),
                );
                setKey('');
                setError('');
                setNotice('');
                setConfirmDelete(false);
              }}
            >
              <span className={`provider-mark ${item.id}`}>{item.mark}</span>
              <span>
                <strong>{item.name}</strong>
                <small>{item.kind}</small>
              </span>
              <span className="provider-state">
                {isProvider(item.id)
                  ? providers === null
                    ? pending
                      ? '读取中'
                      : '状态未知'
                    : credentialErrors[item.id]
                      ? '凭据不可读'
                      : providers[item.id]
                        ? '已保存'
                        : '未配置'
                  : '待接入'}
              </span>
            </button>
          ))}
        </div>
        <section className="provider-detail" aria-label={`${service.name}配置`}>
          <header>
            <span className={`provider-mark ${service.id}`}>{service.mark}</span>
            <div>
              <h3>{service.name}</h3>
              <p>{service.description}</p>
            </div>
            <span className="settings-pill">
              {available
                ? agentProviderFor(defaultModel) === service.id
                  ? '默认对话服务'
                  : '可用对话服务'
                : '配置预览'}
            </span>
          </header>
          {!available && <div className="provider-notice">{service.note}</div>}
          <label>
            接口地址
            <input value={service.endpoint} readOnly aria-label="接口地址" />
          </label>
          <label>
            {service.kind === '对话模型' ? '模型' : '服务'}
            {available ? (
              <select
                aria-label="模型选择"
                value={selectedModel}
                disabled={pending}
                onChange={(e) => setSelectedModel(e.target.value as AgentModel)}
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input value={service.model} readOnly aria-label="模型或服务名称" />
            )}
          </label>
          <label>
            {service.id === 'mineru' ? 'API Token' : 'API Key'}
            <input
              aria-label={`${service.name} API Key`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={!available || pending}
              maxLength={512}
              placeholder={
                available
                  ? configured || credentialErrors[provider]
                    ? '输入新 Key 以替换已有密钥'
                    : '输入你的 API Key'
                  : '服务接入后可配置'
              }
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <p className="provider-help">
            {available
              ? '密钥仅加密保存在此设备，不回显。保存不会发送材料，也不代表连接验证成功。'
              : '当前预览不收集或保存密钥，不会发起外部请求。'}
          </p>
          {available && credentialErrors[provider] && (
            <div className="assistant-error" role="alert">
              系统安全凭据暂不可读；旧密文已保留，不表示密钥已删除。未发起模型请求，人工任务与正文仍可使用。
            </div>
          )}
          {error && (
            <div className="assistant-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="settings-notice" role="status">
              {notice}
            </div>
          )}
          <div className="provider-actions">
            <button
              className="primary"
              disabled={!available || pending || !validKey}
              onClick={() =>
                void execute({ protocol_version: 1, operation: 'configure', provider, key })
              }
            >
              {pending ? '处理中…' : '保存 Key'}
            </button>
            {available && (
              <>
                <button
                  disabled={pending}
                  onClick={() =>
                    void execute({ protocol_version: 1, operation: 'refresh_credentials' })
                  }
                >
                  重新读取系统凭据
                </button>
                <button
                  disabled={pending || (configured !== true && !credentialErrors[provider])}
                  onClick={() => setConfirmDelete(true)}
                >
                  删除 Key
                </button>
              </>
            )}
          </div>
          {available && (
            <div className="model-default-control">
              <p>当前默认：{agentModelLabel(defaultModel)}</p>
              <button
                disabled={pending || !configured || selectedModel === defaultModel}
                onClick={() =>
                  void execute({
                    protocol_version: 1,
                    operation: 'select_model',
                    model: selectedModel,
                  })
                }
              >
                设为默认模型
              </button>
              <p className="provider-help">
                保存 Key 不会自动切换模型。默认模型用于下一次发送，运行中不可修改。
              </p>
            </div>
          )}
          {available && confirmDelete && (
            <div className="key-delete-confirm" role="group" aria-label="确认删除密钥">
              <p>删除此设备的 {service.name} 密钥？已有任务和正文会保留。</p>
              <button
                disabled={pending}
                onClick={() =>
                  void execute({ protocol_version: 1, operation: 'clear_key', provider })
                }
              >
                确认删除
              </button>
              <button disabled={pending} onClick={() => setConfirmDelete(false)}>
                取消
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
