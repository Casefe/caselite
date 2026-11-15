import type { SkinId, Theme } from '../../preload/caselite-api';

export function readAppearanceSeed() {
  const initial = window.caseliteAppearance;
  return {
    theme: initial?.ok ? initial.theme : ('light' as Theme),
    skin: initial?.ok ? initial.skin : undefined,
    ready: initial?.ok === true,
  };
}

export function applyAppearanceTheme(theme: Theme, skin?: SkinId) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // 缺省保留旧版视觉；恢复原版明确移除选择器，不自动套用任一新增风格。
  if (skin === undefined) delete root.dataset.skin;
  else root.dataset.skin = skin;
}
