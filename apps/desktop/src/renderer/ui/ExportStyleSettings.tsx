import type { ExportStyle } from '../../preload/caselite-api';
import { useLocalPreferences } from '../shared/data/LocalPreferences';

export default function ExportStyleSettings({ disabled }: { disabled: boolean }) {
  const s = useLocalPreferences();
  const style = s.draft.export_style ?? window.caselite.exportStyleDefaults;
  if (!style) return null;
  const change = (patch: Partial<ExportStyle>) =>
    s.change({ export_style: { ...style, ...patch } });
  return (
    <fieldset className="export-style-settings" disabled={disabled || !s.ready}>
      <legend>导出样式 · Word / PDF</legend>
      <p>应用于下一次固定版本导出；已有文件保留。PDF 预览与另存使用同一份最终文件。</p>
      <div className="export-style-grid">
        <label>
          纸张
          <select
            aria-label="导出纸张"
            value={style.paper}
            onChange={(e) => change({ paper: e.target.value as ExportStyle['paper'] })}
          >
            <option>A4</option>
            <option>Letter</option>
          </select>
        </label>
        <label>
          字体
          <select
            aria-label="导出字体"
            value={style.font}
            onChange={(e) => change({ font: e.target.value as ExportStyle['font'] })}
          >
            <option value="arial-unicode">Arial Unicode MS</option>
            {style.font === 'pingfang' && (
              <option value="pingfang" disabled>
                苹方（当前未开放）
              </option>
            )}
          </select>
        </label>
        <label>
          字号（pt）
          <input
            aria-label="导出字号"
            type="number"
            min={10}
            max={24}
            step={0.5}
            required
            value={style.font_size}
            onChange={(e) => change({ font_size: e.target.valueAsNumber })}
          />
        </label>
        {(['top', 'right', 'bottom', 'left'] as const).map((side, i) => (
          <label key={side}>
            {['上', '右', '下', '左'][i]}边距（mm）
            <input
              aria-label={`导出${['上', '右', '下', '左'][i]}边距`}
              type="number"
              min={(side === 'top' && style.header) || (side === 'bottom' && style.footer) ? 12 : 8}
              max={50}
              step={1}
              required
              value={style.margins[side]}
              onChange={(e) =>
                change({ margins: { ...style.margins, [side]: e.target.valueAsNumber } })
              }
            />
          </label>
        ))}
      </div>
      <label>
        页眉
        <input
          aria-label="导出页眉"
          maxLength={120}
          value={style.header}
          onChange={(e) => change({ header: e.target.value })}
        />
      </label>
      <label>
        页脚
        <input
          aria-label="导出页脚"
          maxLength={120}
          value={style.footer}
          onChange={(e) => change({ footer: e.target.value })}
        />
      </label>
      <small>
        可使用 {'{page}'} 和 {'{pages}'}{' '}
        显示当前页和总页数。页眉、页脚为纯文本；有内容时对应边距至少 12 mm。
      </small>
    </fieldset>
  );
}
