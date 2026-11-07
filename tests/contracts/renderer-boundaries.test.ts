import { expect, it } from 'vitest';
import { boundaryViolation } from '../../scripts/check-architecture-boundaries.mjs';

const root = 'apps/desktop/src/renderer/';
it('rejects page dependencies from shared primitives and private cross-feature imports', () => {
  for (const [from, to] of [
    ['shared/ui/PropertyRow.tsx', 'features/projects/ProjectFields.tsx'],
    ['shared/navigation/ModelSettingsNavigation.ts', 'ui/SettingsView.tsx'],
    ['shared/data/catalogMutation.ts', 'ui/useCatalog.ts'],
    ['shared/discussion/DiscussionFeed.tsx', 'features/projects/ProjectCatalog.tsx'],
    ['features/documents/BodyEditor.tsx', 'features/projects/ProjectEditor.tsx'],
    ['features/projects/ProjectCatalog.tsx', 'features/finance/FinanceView.tsx'],
    ['features/documents/BodyEditor.tsx', 'features/documents/review/document-review-transport.ts'],
    ['ui/AgentPanel.tsx', 'features/projects/ProjectFields.tsx'],
  ])
    expect(boundaryViolation(root + from, './probe', root + to)).toBeTruthy();
});

it('allows explicit public entries and local/shared implementation without opening IPC boundaries', () => {
  for (const [from, to] of [
    ['features/projects/ProjectFields.tsx', 'shared/ui/PropertyRow.tsx'],
    ['features/projects/ProjectCatalog.tsx', 'features/projects/ProjectEditor.tsx'],
    ['features/projects/ProjectCatalog.tsx', 'features/finance/money.ts'],
    ['features/documents/BodyEditor.tsx', 'features/documents/review/DocumentReview.tsx'],
    ['ui/AgentPanel.tsx', 'features/projects/project-display.ts'],
    ['ui/TaskInspector.tsx', 'features/projects/TaskProjectAction.tsx'],
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
