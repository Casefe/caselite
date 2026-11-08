import { useEditorState, type Editor } from '@tiptap/react';
import { TableMap } from '@tiptap/pm/tables';

const commands = [
  ['addRowBefore', '上方插入行'],
  ['addRowAfter', '下方插入行'],
  ['addColumnBefore', '左侧插入列'],
  ['addColumnAfter', '右侧插入列'],
  ['mergeCells', '合并所选单元格'],
  ['splitCell', '拆分单元格'],
  ['toggleHeaderRow', '切换表头行'],
  ['deleteRow', '删除行'],
  ['deleteColumn', '删除列'],
  ['deleteTable', '删除表格'],
] as const;

function allowed(editor: Editor, command: (typeof commands)[number][0]) {
  if (!editor.isEditable || !editor.can()[command]()) return false;
  const at = editor.state.selection.$from;
  for (let depth = at.depth; depth > 0; depth--) {
    const node = at.node(depth);
    if (node.type.name !== 'table') continue;
    if ((command === 'addRowBefore' || command === 'addRowAfter') && node.childCount >= 200)
      return false;
    if (
      (command === 'addColumnBefore' || command === 'addColumnAfter') &&
      TableMap.get(node).width >= 100
    )
      return false;
    break;
  }
  return true;
}

export function TableCommands({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      editable: current.isEditable,
      table: current.isActive('table'),
      insert: current.can().insertTable({ rows: 2, cols: 2, withHeaderRow: false }),
      allowed: commands.map(([command]) => allowed(current, command)),
    }),
  });
  return (
    <select
      aria-label="表格操作"
      value=""
      disabled={!state.editable}
      onMouseDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        if (!editor.isEditable) return;
        const command = event.target.value;
        if (command === 'insert' && !editor.isActive('table'))
          editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run();
        else {
          const entry = commands.find(([name]) => name === command);
          // 重新核对当前选区；打开菜单后文档/权限可能已经变化。
          if (entry && allowed(editor, entry[0])) editor.chain().focus()[entry[0]]().run();
        }
        event.target.value = '';
      }}
    >
      <option value="">表格</option>
      <option value="insert" disabled={!state.insert || state.table}>
        插入 2 × 2 表格
      </option>
      {commands.map(([command, label], index) => (
        <option key={command} value={command} disabled={!state.table || !state.allowed[index]}>
          {label}
        </option>
      ))}
    </select>
  );
}
