import AgentPanel from './AgentPanel';
import { Icon } from './Workspace';

export default function SidebarAgent({
  taskId,
  blocked = false,
  unavailable,
}: {
  taskId?: string;
  blocked?: boolean;
  unavailable?: string;
}) {
  return (
    <div className="sidebar-agent" inert={blocked}>
      {taskId ? (
        <AgentPanel key={taskId} scope={taskId} variant="compact" />
      ) : (
        // 无 Task scope 时仅渲染输入区外观，不初始化 Agent 或材料控制器。
        <section className="assistant-panel assistant-panel--compact" aria-label="AI 对话未启用">
          <div className="assistant-compose agent-prompt">
            <div className="material-composer">
              <textarea
                className="assistant-input"
                aria-label="AI 对话输入"
                placeholder="输入消息"
                rows={2}
                disabled
              />
              <div className="assistant-actions">
                <div className="material-menu">
                  <button
                    type="button"
                    className="material-menu-trigger"
                    aria-label="添加文件与材料"
                    disabled
                  >
                    <Icon name="plus" size={18} />
                  </button>
                </div>
                <select className="home-model-select" aria-label="选择大模型" disabled>
                  <option>选择模型</option>
                </select>
                <button
                  type="button"
                  className="primary assistant-submit"
                  aria-label="发送"
                  disabled
                >
                  发送
                </button>
              </div>
            </div>
          </div>
          <p className="assistant-run-status" role="status">
            {unavailable}
          </p>
        </section>
      )}
    </div>
  );
}
