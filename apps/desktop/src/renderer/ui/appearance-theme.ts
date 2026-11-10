import type { Theme } from '../../preload/caselite-api';

export function readAppearanceSeed() {
  const initial = window.caseliteAppearance;
  return { theme: initial?.ok ? initial.theme : ('light' as Theme), ready: initial?.ok === true };
}

export function applyAppearanceTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}
