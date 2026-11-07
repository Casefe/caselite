import { Icon } from '../../shared/ui/Icon';
import { useState } from 'react';

import { DraftEditor, emptyDraft, type RichDraft } from '../../editors/RichEditor';
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
export default function ProjectPreview({ onAgent }: { onAgent(): void }) {
  const [descriptions, setDescriptions] = useState<Record<string, RichDraft>>(() =>
    Object.fromEntries(projects.map((p) => [p.id, { text: p.description, state: null }])),
  );
  const [commentDrafts, setCommentDrafts] = useState<Record<string, RichDraft>>({});
  const [comments, setComments] = useState<Record<string, RichDraft[]>>({});
  const [layout, setLayout] = useState<'list' | 'board'>('list');
  const [selected, setSelected] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState(projects[0].id);
  const [tab, setTab] = useState('概述');
  const [filter, setFilter] = useState('全部状态');
  const [detail, setDetail] = useState<string | null>(null);
  const project = projects.find((p) => p.id === selected);
  const shown = projects.filter((p) => filter === '全部状态' || p.status === filter);
  const preview = shown.find((p) => p.id === previewId) ?? shown[0];
  const openProject = (id: string) => {
    setSelected(id);
    setTab('概述');
  };
  return (
    <section data-layout="three-column" className="project-view" data-testid="project-preview">
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
                  <div className="project-overview-editor">
                    <DraftEditor
                      key={`overview:${project.id}`}
                      value={descriptions[project.id]}
                      onChange={(value) =>
                        setDescriptions((all) => ({ ...all, [project.id]: value }))
                      }
                      label="示例项目概述"
                      testId="project-overview-editor"
                      placeholder="输入项目概述，使用 / 插入内容块…"
                    />
                    <p className="caption">概述编辑为示例，不写入本地数据库。</p>
                  </div>
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
                  <section className="project-comments">
                    <h3>
                      评论 <small className="sample-badge">示例 · 不保存</small>
                    </h3>
                    {(comments[project.id] ?? []).map((comment, i) => (
                      <div className="posted-comment" key={i}>
                        <span>我 · 示例评论</span>
                        <DraftEditor
                          value={comment}
                          onChange={() => {}}
                          label="示例评论内容"
                          disabled
                        />
                      </div>
                    ))}
                    <div className="comment-composer">
                      <DraftEditor
                        key={`comment:${project.id}:${comments[project.id]?.length ?? 0}`}
                        value={commentDrafts[project.id] ?? emptyDraft()}
                        onChange={(value) =>
                          setCommentDrafts((all) => ({ ...all, [project.id]: value }))
                        }
                        label="示例评论"
                        testId="comment-editor"
                        placeholder="写下评论，支持 / 和选区格式…"
                      />
                      <footer>
                        <span>仅展示编辑与添加，不发送给他人</span>
                        <button
                          type="button"
                          data-testid="add-sample-comment"
                          disabled={
                            !commentDrafts[project.id]?.text.trim() ||
                            (commentDrafts[project.id]?.text.length ?? 0) > 4000
                          }
                          onClick={() => {
                            const draft = commentDrafts[project.id];
                            if (!draft?.text.trim()) return;
                            setComments((all) => ({
                              ...all,
                              [project.id]: [...(all[project.id] ?? []), draft],
                            }));
                            setCommentDrafts((all) => ({ ...all, [project.id]: emptyDraft() }));
                          }}
                        >
                          添加示例评论
                        </button>
                      </footer>
                    </div>
                  </section>
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
            <ProjectInspector key={project.id} project={project} onAgent={onAgent} />
          </div>
        </>
      ) : (
        <div className="collection-workspace project-collection">
          <div className="collection-main">
            <div className="collection-heading">
              <Icon name="folder" size={18} />
              <h1>项目</h1>
              <span className="collection-total">{shown.length}</span>
              <span className="sample-count">示例项目</span>
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
            <div className="collection-scroll">
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
                      aria-current={preview?.id === p.id ? 'true' : undefined}
                      onClick={() => setPreviewId(p.id)}
                      onDoubleClick={() => openProject(p.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          openProject(p.id);
                        }
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
            </div>
            <footer className="collection-footer">
              <span>示例内容 · 不保存</span>
              <span>
                {layout === 'list' ? '单击查看属性 · 双击或 Enter 打开' : '单击卡片打开项目'}
              </span>
            </footer>
          </div>
          {preview ? (
            <ProjectInspector
              key={preview.id}
              project={preview}
              onOpen={() => openProject(preview.id)}
              onAgent={onAgent}
            />
          ) : (
            <aside className="task-inspector inspector-content">没有匹配的项目</aside>
          )}
        </div>
      )}
    </section>
  );
}

function ProjectInspector({
  project,
  onOpen,
  onAgent,
}: {
  project: (typeof projects)[number];
  onOpen?(): void;
  onAgent(): void;
}) {
  const [tab, setTab] = useState<'properties' | 'ai'>('properties');
  return (
    <aside className="task-inspector project-properties" aria-label="项目属性与 AI 侧边栏">
      <div className="inspector-tabs" role="tablist" aria-label="项目侧边栏栏目">
        <button
          role="tab"
          aria-selected={tab === 'properties'}
          onClick={() => setTab('properties')}
        >
          <Icon name="panel" size={15} />
          属性
        </button>
        <button role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')}>
          <Icon name="spark" size={15} />
          AI 助手
        </button>
      </div>
      <div
        className="inspector-content"
        role="tabpanel"
        aria-label={tab === 'properties' ? '项目属性' : '项目 AI 助手'}
      >
        <div className="inspector-heading">
          <Icon name="folder" size={16} />
          示例项目
        </div>
        <h2>{project.name}</h2>
        {tab === 'properties' ? (
          <>
            {onOpen && (
              <button data-testid="open-project" className="inspector-open" onClick={onOpen}>
                打开项目
                <Icon name="chevron" size={13} />
              </button>
            )}
            <p className="inspector-objective">{project.description}</p>
            <h3>属性</h3>
            <dl>
              <dt>状态</dt>
              <dd>
                <span className={`status-tag ${project.color}`}>{project.status}</span>
              </dd>
              <dt>负责人</dt>
              <dd>{project.owner}</dd>
              <dt>任务</dt>
              <dd>{project.tasks.length} 项示例任务</dd>
              <dt>日期</dt>
              <dd>未设置</dd>
              <dt>领域</dt>
              <dd>{project.id === 'sample-labor' ? '劳动争议' : '合同事务'}</dd>
            </dl>
            <hr />
            <p className="caption">项目属性与归组为界面示例，尚未保存到本地数据库。</p>
          </>
        ) : (
          <div className="project-agent-empty">
            <Icon name="spark" size={25} />
            <h3>项目 AI 上下文待接入</h3>
            <p>
              项目材料和任务归组接入后，可围绕选定项目工作。当前可前往首页使用
              Agent，示例项目不会发送给模型。
            </p>
            <button onClick={onAgent}>
              前往首页 Agent
              <Icon name="chevron" size={13} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
