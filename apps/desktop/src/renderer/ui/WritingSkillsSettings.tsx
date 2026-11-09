import { useLocalPreferences } from '../shared/data/LocalPreferences';
import { defaultWritingSkills, writingSkills } from '../shared/data/writing-skills';
import type { WritingSkill } from '../../preload/caselite-api';

export default function WritingSkillsSettings({ disabled }: { disabled: boolean }) {
  const s = useLocalPreferences();
  const skills = writingSkills(s.draft.writing_skills);
  const update = (next: readonly WritingSkill[]) => s.change({ writing_skills: [...next] });
  const edit = (id: string, patch: Partial<WritingSkill>) =>
    update(skills.map((skill) => (skill.id === id ? { ...skill, ...patch } : skill)));
  const move = (index: number, offset: number) => {
    const next = [...skills];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update(next);
  };
  return (
    <fieldset disabled={disabled} className="writing-skills-settings">
      <legend>自定义写作技能</legend>
      <p className="editor-settings-note">
        选中文字后从右键或选区菜单使用。前三个已启用技能直接展示，点击即开始 AI
        分析，确认候选后才修改正文。最多 20 项。
      </p>
      {skills.map((skill, index) => (
        <section className="writing-skill-card" key={skill.id} aria-label={`技能 ${index + 1}`}>
          <div className="writing-skill-heading">
            <label>
              <input
                type="checkbox"
                checked={skill.enabled}
                onChange={(e) => edit(skill.id, { enabled: e.target.checked })}
              />
              显示在写作菜单
            </label>
            <div>
              <button
                type="button"
                aria-label={`上移${skill.name}`}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`下移${skill.name}`}
                disabled={disabled || index === skills.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`删除${skill.name}`}
                onClick={() => update(skills.filter((s) => s.id !== skill.id))}
              >
                删除
              </button>
            </div>
          </div>
          <label>
            技能名称
            <input
              aria-label={`技能 ${index + 1} 名称`}
              required
              maxLength={40}
              value={skill.name}
              onChange={(e) => edit(skill.id, { name: e.target.value })}
            />
          </label>
          <label>
            执行指令
            <textarea
              aria-label={`技能 ${index + 1} 指令`}
              required
              maxLength={3000}
              rows={3}
              value={skill.instruction}
              onChange={(e) => edit(skill.id, { instruction: e.target.value })}
            />
          </label>
        </section>
      ))}
      {!skills.length && <p className="editor-settings-note">尚无写作技能，可以新增或恢复默认。</p>}
      <div className="personal-settings-actions">
        <button
          type="button"
          disabled={disabled || skills.length >= 20}
          onClick={() =>
            update([
              ...skills,
              { id: crypto.randomUUID(), name: '新技能', instruction: '', enabled: true },
            ])
          }
        >
          新增技能
        </button>
        <button type="button" onClick={() => update(defaultWritingSkills)}>
          恢复五个默认技能
        </button>
      </div>
      <p className="editor-settings-note">
        保存后生效。技能仅包含名称和指令，不授予工具权限；当前支持单段纯文本，格式整理不包含页面排版。
      </p>
    </fieldset>
  );
}
