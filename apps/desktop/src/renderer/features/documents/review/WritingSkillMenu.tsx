import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import type { WritingSkill } from '../../../../preload/caselite-api';
import { useLocalPreferences } from '../../../shared/data/LocalPreferences';
import { writingSkills } from '../../../shared/data/writing-skills';
import { EditorSettingsNavigation } from '../../../shared/navigation/EditorSettingsNavigation';
import { editorSelection } from './editor-selection';

export type WritingSkillRequest = {
  id: string;
  skill: WritingSkill;
  doc: object;
  from: number;
  to: number;
  revision: number;
};
export type WritingSkillHandle = { pick(request: WritingSkillRequest): void };
export default function WritingSkillMenu({
  editor,
  enabled,
  revision,
  onPick,
}: {
  editor: Editor;
  enabled: boolean;
  revision: number;
  onPick(request: WritingSkillRequest): void;
}) {
  const { preferences } = useLocalPreferences();
  const openSettings = useContext(EditorSettingsNavigation);
  const skills = writingSkills(preferences.writing_skills).filter((skill) => skill.enabled);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const captured = useRef<{ doc: object; from: number; to: number } | null>(null);
  const eligible = () =>
    enabled &&
    editor.isEditable &&
    !editor.view.composing &&
    Boolean(editorSelection(editor)?.text);
  const open = useCallback(
    (x: number, y: number) => {
      setPortalTarget(trigger.current?.closest('.selection-tools') ?? null);
      captured.current = {
        doc: editor.state.doc,
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      };
      setPosition({
        left: Math.max(8, Math.min(x, window.innerWidth - 276)),
        top: Math.max(8, Math.min(y, window.innerHeight - 340)),
      });
    },
    [editor],
  );
  useEffect(() => {
    const element = editor.view.dom;
    const context = (event: MouseEvent) => {
      if (editor.view.composing || editor.state.selection.empty) return;
      event.preventDefault();
      open(event.clientX, event.clientY);
    };
    const close = () => setPosition(undefined);
    element.addEventListener('contextmenu', context);
    editor.on('selectionUpdate', close);
    editor.on('update', close);
    return () => {
      element.removeEventListener('contextmenu', context);
      editor.off('selectionUpdate', close);
      editor.off('update', close);
    };
  }, [editor, open]);
  useEffect(() => {
    if (!position) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setPosition(undefined);
    };
    const close = () => setPosition(undefined);
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', scroll, true);
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="writing-skills-trigger"
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (position) setPosition(undefined);
          else {
            const r = trigger.current!.getBoundingClientRect();
            open(r.left, r.bottom + 6);
          }
        }}
      >
        ✧ 技能
      </button>
      {position &&
        createPortal(
          <div
            ref={menu}
            className="writing-skills-menu"
            role="menu"
            aria-label="写作技能"
            style={{
              ...position,
              maxHeight: Math.min(420, window.innerHeight - position.top - 16),
            }}
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setPosition(undefined);
                editor.commands.focus();
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const buttons = [
                  ...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                ];
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                buttons[
                  (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
                ]?.focus();
              }
            }}
          >
            <div className="writing-skills-menu-heading">写作技能</div>
            {skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                role="menuitem"
                disabled={!eligible()}
                onClick={() => {
                  const original = captured.current;
                  // 只将同一修订的原选区交给右栏；菜单打开后的编辑或选区变化不能错用旧坐标。
                  if (
                    !original ||
                    !eligible() ||
                    original.doc !== editor.state.doc ||
                    original.from !== editor.state.selection.from ||
                    original.to !== editor.state.selection.to
                  )
                    return;
                  onPick({ id: crypto.randomUUID(), skill: { ...skill }, ...original, revision });
                  setPosition(undefined);
                }}
              >
                {skill.name}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
            {!eligible() && (
              <p>请先保存正文，并在同一段落内选择文字。生成或确认期间请先处理当前候选。</p>
            )}
            {!skills.length && <p>可在编辑器设置中添加技能。</p>}
            {openSettings && (
              <button
                type="button"
                role="menuitem"
                className="writing-skills-manage"
                onClick={() => {
                  setPosition(undefined);
                  openSettings();
                }}
              >
                管理自定义技能…
              </button>
            )}
          </div>,
          // 子菜单仍属于当前选区浮层，避免焦点转移触发父浮层注销和Yjs重投影。
          portalTarget ?? document.body,
        )}
    </>
  );
}
