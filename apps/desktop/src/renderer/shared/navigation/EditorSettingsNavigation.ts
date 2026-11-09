import { createContext } from 'react';

export const EditorSettingsNavigation = createContext<(() => void) | null>(null);
