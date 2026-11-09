import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InspectorSection } from '../../../apps/desktop/src/renderer/shared/ui/InspectorSection';
import { PropertyValue } from '../../../apps/desktop/src/renderer/shared/ui/PropertyRow';

function UiCaptureSample() {
  const [selected, setSelected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <main id="sample">
      <h1>合成项目 · 属性</h1>
      <InspectorSection title="属性">
        <dl>
          <PropertyValue label="状态">
            <button
              id="select"
              role="option"
              aria-selected={selected}
              onClick={() => setSelected(true)}
            >
              进行中
            </button>
          </PropertyValue>
          <PropertyValue label="负责人">本人（合成）</PropertyValue>
        </dl>
      </InspectorSection>
      <p role="status" id="status">
        {loading ? '正在加载合成任务…' : '暂无关联任务'}
      </p>
      <p role="alert" hidden={!failed}>
        合成保存失败，可重试
      </p>
      <div className="capture-actions">
        <button id="load" onClick={() => setLoading(true)}>
          模拟加载
        </button>
        <button id="error" onClick={() => setFailed(true)}>
          模拟失败
        </button>
      </div>
      <p data-private>合成敏感占位，不应采集</p>
      <input aria-label="合成私密输入" defaultValue="DO-NOT-CAPTURE" />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<UiCaptureSample />);
