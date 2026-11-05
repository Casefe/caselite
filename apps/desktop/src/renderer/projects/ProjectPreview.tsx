import { useState } from 'react';
import { Icon } from '../ui/Workspace';
const projects = [
  {
    id: 'sample-contract',
    name: '海川服务合同争议',
    description: '围绕合同金额、履行情况与来往记录，梳理事实、识别材料缺口，准备内部沟通成果。',
    status: '进行中',
    owner: '承办律师',
    color: 'blue',
    tasks: ['梳理合同与补充材料', '核对金额差异与履行凭证', '形成内部沟通初稿'],
  },
  {
    id: 'sample-labor',
    name: '明远劳动争议',
    description: '整理劳动关系材料与当事人陈述，明确待补文件和下一步工作。',
    status: '待开始',
    owner: '承办律师',
    color: 'amber',
    tasks: ['整理已收到的材料', '列出证据缺口'],
  },
  {
    id: 'sample-review',
    name: '采购协议审查',
    description: '对照选定条款与内部审查清单，形成可回原文的问题表。',
    status: '已完成',
    owner: '承办律师',
    color: 'green',
    tasks: ['核对交易结构', '整理审查问题表'],
  },
];
const tabs = ['概述', '任务', '文件', '交付物', '活动'];
export default function ProjectPreview() {
  const [layout, setLayout] = useState<'list' | 'board'>('list');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState('概述');
  const [filter, setFilter] = useState('全部状态');
  const [detail, setDetail] = useState<string | null>(null);
  const project = projects.find((p) => p.id === selected);
  const shown = projects.filter((p) => filter === '全部状态' || p.status === filter);
  return (
    <section className="project-view" data-testid="project-preview">
      <div className="page-topline">
        <span>
          工作区 <Icon name="chevron" size={13} /> 项目
          {project && (
            <>
              {' '}
              <Icon name="chevron" size={13} /> {project.name}
            </>
          )}
        </span>
        <span className="sample-badge">示例项目 · 不保存</span>
      </div>
      {project ? (
        <>
          <div className="project-titlebar">
            <button
              className="icon-button"
              aria-label="返回项目列表"
              onClick={() => {
                setSelected(null);
                setDetail(null);
              }}
            >
              <Icon name="back" />
            </button>
            <span className={`project-icon ${project.color}`}>
              <Icon name="folder" size={22} />
            </span>
            <div>
              <h1>{project.name}</h1>
              <p>项目工作区</p>
            </div>
            <span className={`status-tag ${project.color}`}>{project.status}</span>
          </div>
          <div className="project-tabs" role="tablist" aria-label="项目栏目">
            {tabs.map((t) => (
              <button
                role="tab"
                aria-selected={tab === t}
                key={t}
                data-project-tab={t}
                onClick={() => {
                  setTab(t);
                  setDetail(null);
                }}
              >
                {t}
                {t === '任务' && <small>{project.tasks.length}</small>}
              </button>
            ))}
          </div>
          <div className="project-body">
            <div className="project-content">
              {tab === '概述' ? (
                <>
                  <h2>项目概述</h2>
                  <p className="overview-text">{project.description}</p>
                  <h3>工作成果</h3>
                  <p>围绕明确的法律工作目标，保留材料来源、事实矛盾和人工核对记录。</p>
                  <h3>工作阶段</h3>
                  <div className="milestones">
                    <div>
                      <i className="done" />
                      明确任务 <small>目标与范围</small>
                    </div>
                    <div>
                      <i />
                      整理资料 <small>选定材料与缺件</small>
                    </div>
                    <div>
                      <i />
                      起草与核对 <small>形成内部成果</small>
                    </div>
                  </div>
                  <div className="project-note">
                    <Icon name="folder" />
                    <div>
                      <strong>这里展示项目管理的布局与交互</strong>
                      <p>项目、任务和属性均为示例。正式项目归组接入后，继续使用同一套页面。</p>
                    </div>
                  </div>
                </>
              ) : tab === '任务' ? (
                <>
                  <div className="section-title">
                    <h2>项目任务</h2>
                    <span>{project.tasks.length} 项示例</span>
                  </div>
                  <div className="sample-task-list">
                    {project.tasks.map((t, i) => (
                      <button key={t} data-sample-task={i} onClick={() => setDetail(t)}>
                        <span className="circle-state" />
                        <small>示例 {i + 1}</small>
                        <strong>{t}</strong>
                        <span>待处理</span>
                        <Icon name="chevron" size={14} />
                      </button>
                    ))}
                  </div>
                  {detail && (
                    <section className="sample-detail">
                      <div>
                        <h3>{detail}</h3>
                        <button onClick={() => setDetail(null)} aria-label="关闭示例任务详情">
                          关闭
                        </button>
                      </div>
                      <p>此任务用于走查列表、详情和返回路径，不会创建或修改你的本地任务。</p>
                    </section>
                  )}
                </>
              ) : (
                <div className="project-tab-empty">
                  <Icon
                    name={tab === '文件' ? 'folder' : tab === '交付物' ? 'file' : 'clock'}
                    size={30}
                  />
                  <h2>{tab}</h2>
                  <p>此示例尚未提供{tab}数据。选择其他栏目继续查看布局。</p>
                </div>
              )}
            </div>
            <aside className="project-properties">
              <h3>属性</h3>
              <dl>
                <dt>状态</dt>
                <dd>
                  <span className={`status-tag ${project.color}`}>{project.status}</span>
                </dd>
                <dt>负责人</dt>
                <dd>
                  <span className="mini-avatar">律</span>
                  {project.owner}
                </dd>
                <dt>优先级</dt>
                <dd>普通</dd>
                <dt>日期</dt>
                <dd className="muted">未设置</dd>
                <dt>领域</dt>
                <dd>
                  <span className="label-tag">
                    {selected === 'sample-labor' ? '劳动争议' : '合同事务'}
                  </span>
                </dd>
              </dl>
              <hr />
              <p className="caption">示例属性仅用于确认页面设计。</p>
            </aside>
          </div>
        </>
      ) : (
        <>
          <div className="page-title">
            <div>
              <p className="eyebrow">项目管理</p>
              <h1>项目</h1>
              <p>把相关任务、材料和成果组织在同一处。</p>
            </div>
            <span className="sample-count">3 个示例项目</span>
          </div>
          <div className="view-toolbar">
            <div className="view-tabs">
              <button className="current">
                全部项目 <small>3</small>
              </button>
            </div>
            <div className="view-options">
              <label className="filter-select">
                状态{' '}
                <select
                  aria-label="筛选示例项目状态"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {['全部状态', '进行中', '待开始', '已完成'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <div className="segmented">
                <button
                  aria-label="项目列表视图"
                  aria-pressed={layout === 'list'}
                  onClick={() => setLayout('list')}
                >
                  <Icon name="list" size={16} />
                </button>
                <button
                  aria-label="项目看板视图"
                  aria-pressed={layout === 'board'}
                  onClick={() => setLayout('board')}
                >
                  <Icon name="grid" size={16} />
                </button>
              </div>
            </div>
          </div>
          {layout === 'list' ? (
            <div className="project-list">
              <div className="project-list-head">
                <span>项目名称</span>
                <span>状态</span>
                <span>负责人</span>
                <span>任务</span>
              </div>
              {shown.map((p) => (
                <button
                  data-project-id={p.id}
                  className="project-row"
                  key={p.id}
                  onClick={() => {
                    setSelected(p.id);
                    setTab('概述');
                  }}
                >
                  <span>
                    <span className={`project-icon ${p.color}`}>
                      <Icon name="folder" />
                    </span>
                    <strong>{p.name}</strong>
                  </span>
                  <span className={`status-tag ${p.color}`}>{p.status}</span>
                  <span className="muted">{p.owner}</span>
                  <span className="task-total">{p.tasks.length} 项</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="project-board">
              {['待开始', '进行中', '已完成'].map((status) => (
                <section key={status}>
                  <h3>
                    <span className="circle-state" />
                    {status}
                    <small>{shown.filter((p) => p.status === status).length}</small>
                  </h3>
                  {shown
                    .filter((p) => p.status === status)
                    .map((p) => (
                      <button
                        className="project-card"
                        data-project-id={p.id}
                        key={p.id}
                        onClick={() => {
                          setSelected(p.id);
                          setTab('概述');
                        }}
                      >
                        <Icon name="folder" />
                        <h3>{p.name}</h3>
                        <p>{p.description}</p>
                        <footer>
                          <span>{p.tasks.length} 项任务</span>
                          <span className="mini-avatar">律</span>
                        </footer>
                      </button>
                    ))}
                </section>
              ))}
            </div>
          )}
          <p className="prototype-footnote">
            可点击项目查看概述、任务和属性。示例内容不会进入本地数据库。
          </p>
        </>
      )}
    </section>
  );
}
