import { expect, it } from 'vitest';
import { boundaryViolation } from '../../scripts/check-architecture-boundaries.mjs';

const root = 'apps/desktop/src/renderer/';
it('rejects page dependencies from shared primitives and private cross-feature imports', () => {
  for (const [from, to] of [
    ['shared/ui/PropertyRow.tsx', 'projects/ProjectFields.tsx'],
    ['shared/navigation/ModelSettingsNavigation.ts', 'ui/SettingsView.tsx'],
    ['shared/data/catalogMutation.ts', 'ui/useCatalog.ts'],
    ['shared/discussion/DiscussionFeed.tsx', 'projects/ProjectCatalog.tsx'],
    ['features/documents/BodyEditor.tsx', 'projects/ProjectEditor.tsx'],
    ['projects/ProjectCatalog.tsx', 'finance/FinanceView.tsx'],
    ['ui/AgentPanel.tsx', 'projects/ProjectFields.tsx'],
  ])
    expect(boundaryViolation(root + from, './probe', root + to)).toBeTruthy();
});

it('allows explicit public entries and local/shared implementation without opening IPC boundaries', () => {
  for (const [from, to] of [
    ['projects/ProjectFields.tsx', 'shared/ui/PropertyRow.tsx'],
    ['projects/ProjectCatalog.tsx', 'projects/ProjectEditor.tsx'],
    ['projects/ProjectCatalog.tsx', 'finance/money.ts'],
    ['features/documents/BodyEditor.tsx', 'review/DocumentReview.tsx'],
    ['ui/AgentPanel.tsx', 'projects/project-display.ts'],
    ['ui/TaskInspector.tsx', 'projects/TaskProjectAction.tsx'],
  ])
    expect(boundaryViolation(root + from, './probe', root + to)).toBeNull();
  expect(boundaryViolation(root + 'shared/ui/PropertyRow.tsx', 'node:fs')).toBeTruthy();
  expect(
    boundaryViolation(
      root + 'shared/data/probe.ts',
      '../main/index',
      'apps/desktop/src/main/index.ts',
    ),
  ).toBeTruthy();
});
