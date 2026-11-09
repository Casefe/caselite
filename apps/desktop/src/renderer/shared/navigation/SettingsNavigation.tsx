import type { ReactNode } from 'react';
import { ModelSettingsNavigation } from './ModelSettingsNavigation';
import { EditorSettingsNavigation } from './EditorSettingsNavigation';

export function SettingsNavigation({
  openEditor,
  openModels,
  children,
}: {
  openEditor(): void;
  openModels(): void;
  children: ReactNode;
}) {
  return (
    <EditorSettingsNavigation.Provider value={openEditor}>
      <ModelSettingsNavigation.Provider value={openModels}>
        {children}
      </ModelSettingsNavigation.Provider>
    </EditorSettingsNavigation.Provider>
  );
}
