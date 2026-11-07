const prefix = 'apps/desktop/src/renderer/';
// 审阅位于文档功能下，但其 transport 仍只供审阅内部使用。
const feature = (path) => /^features\/(documents\/review|[^/]+)\//.exec(path)?.[1];

// 已有跨功能消费者只使用窄公开入口；新入口须连同消费者与负例一起审查。
const publicEntries = new Set([
  'features/projects/project-display.ts',
  'features/projects/TaskProjectAction.tsx',
  'features/finance/money.ts',
  'features/documents/review/DocumentReview.tsx',
]);

export function rendererBoundaryViolation(file, target) {
  if (!file.startsWith(prefix) || !target?.startsWith(prefix)) return null;
  const from = file.slice(prefix.length);
  const to = target.slice(prefix.length);
  if (/^shared\/(ui|navigation|data)\//.test(from) && !to.startsWith('shared/'))
    return 'shared primitives cannot depend on renderer pages';
  if (from.startsWith('shared/') && feature(to))
    return 'shared capabilities cannot depend on feature implementation';
  const owner = feature(from);
  const dependency = feature(to);
  if (owner && dependency && owner !== dependency && !publicEntries.has(to))
    return 'cross-feature imports must use an explicit public entry';
  // 旧 ui 目录仍有业务页面，先封住已移出的错误依赖；不把它全部假称纯 UI。
  if (from.startsWith('ui/') && to.startsWith('features/projects/') && !publicEntries.has(to))
    return 'legacy UI consumers cannot import project page internals';
  return null;
}
