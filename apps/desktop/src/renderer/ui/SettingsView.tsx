import { createContext, useEffect, useRef, useState } from 'react';
import { agentProviderFor, agentModelLabel } from './model-labels';
import type { AgentModel, AgentProvider, AgentRequest } from '../../preload/caselite-api';
import { Icon } from './Workspace';
import { ThemeSetting } from './Appearance';

export const ModelSettingsNavigation = createContext<(() => void) | null>(null);
export const settingsSections = ['系统设置', '账户管理', '外观', '模型', '个性化'] as const;
export type SettingsSection = (typeof settingsSections)[number];
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
];

export default function SettingsView({
  section,
  onSection,
  onBack,
}: {
  section: SettingsSection;
  onSection(section: SettingsSection): void;
  onBack(): void;
}) {
  return (
    <section className="settings-center" aria-label="设置中心">
      <aside className="settings-navigation">
        <div className="settings-nav-title">
          <Icon name="settings" size={17} />
          <h1>设置</h1>
        </div>
        <nav aria-label="设置分类">
          {settingsSections.map((name, i) => (
            <button
              key={name}
              aria-current={section === name ? 'page' : undefined}
              onClick={() => onSection(name)}
            >
              <Icon name={['settings', 'home', 'grid', 'spark', 'star'][i]} size={16} />
              {name}
            </button>
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
          <span>设置 / {section}</span>
          <span>仅此设备</span>
        </header>
        <div className="settings-page">
          <h2>{section}</h2>
          {section === '模型' ? (
            <ModelSettings />
          ) : section === '系统设置' ? (
            <>
              <p className="settings-lead">管理本地工作区及数据使用方式。</p>
              <ThemeSetting />
              <SettingRow
                title="工作方式"
                description="任务和正文保存在此设备，无需注册。"
                value="本地优先"
              />
              <SettingRow
                title="AI 使用"
                description="仅发送你在预览中确认的内容。配置密钥不会发起模型请求。"
                value="发送前确认"
              />
              <SettingRow
                title="备份与恢复"
                description="备份选择与隔离恢复将在后续版本开放。"
                value="待接入"
              />
            </>
          ) : section === '账户管理' ? (
            <>
              <p className="settings-lead">本地功能不依赖账号。</p>
              <div className="account-card">
                <span className="account-symbol">我</span>
                <div>
                  <h3>个人本地工作区</h3>
                  <p>当前未登录，也不需要登录。</p>
                </div>
                <span className="settings-pill">本地使用</span>
              </div>
              <SettingRow
                title="同步与团队账户"
                description="跨设备同步和团队协作尚未开放。模型服务的 API Key 在“模型”中单独管理。"
                value="待开放"
              />
            </>
          ) : section === '外观' ? (
            <>
              <p className="settings-lead">选择适合你的工作台外观。</p>
              <ThemeSetting />
              <SettingRow
                title="布局与密度"
                description="左侧导航、中间工作区、右侧属性与 AI；以 1920×1080 为设计基准。"
                value="紧凑 · 三栏"
              />
            </>
          ) : (
            <>
              <p className="settings-lead">保留你的工作方式，逐步完善个人偏好。</p>
              <SettingRow
                title="起草方式"
                description="人工编辑与 AI 辅助并行；AI 回答不会自动改写正文。"
                value="人工确认"
              />
              <SettingRow
                title="写作偏好与职业资料"
                description="自定义写作风格、职业资料及偏好保存尚未开放。"
                value="待接入"
              />
              <SettingRow
                title="收藏"
                description="任务标题旁点星标即可收藏；当前仅在本次会话内有效。"
                value="任务收藏"
              />
            </>
          )}
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
  const [selected, setSelected] = useState('openai');
  const [providers, setProviders] = useState<{ openai: boolean; deepseek: boolean } | null>(null);
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
  const available = service.id === 'openai' || service.id === 'deepseek';
  const provider = service.id as AgentProvider;
  const configured = available ? (providers?.[provider] ?? null) : null;
  const modelOptions: AgentModel[] =
    service.id === 'openai' ? ['gpt-4.1-mini'] : ['deepseek-flash', 'deepseek-v4-pro'];
  const validKey = /^sk-[A-Za-z0-9_-]{8,}$/.test(key.trim()) && key.trim().length <= 512;
  async function execute(request: AgentRequest) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    setNotice('');
    if (request.operation !== 'profile') setKey('');
    try {
      const result = await window.caselite.agent(request);
      if (!mounted.current) return;
      if (result.ok) {
        setProviders(result.providers);
        setDefaultModel(result.model);
        setConfirmDelete(false);
        if (request.operation === 'configure')
          setNotice('密钥已加密保存到此设备。尚未验证服务连接。');
        if (request.operation === 'select_model')
          setNotice(`默认模型已保存：${agentModelLabel(result.model)}。`);
        if (request.operation === 'clear_key') setNotice('已删除本机密钥，人工编辑不受影响。');
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
                    : item.id === 'openai'
                      ? 'gpt-4.1-mini'
                      : 'deepseek-flash',
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
                {item.id === 'openai' || item.id === 'deepseek'
                  ? providers === null
                    ? pending
                      ? '读取中'
                      : '状态未知'
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
                  ? configured
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
                  onClick={() => void execute({ protocol_version: 1, operation: 'profile' })}
                >
                  重新读取状态
                </button>
                <button
                  disabled={pending || configured !== true}
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
