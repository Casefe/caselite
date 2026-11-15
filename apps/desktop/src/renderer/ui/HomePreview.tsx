import { createContext, useContext } from 'react';

export type HomePreviewEntry = {
  owner: string;
  session: string;
  title: string;
  close(restoreFocus?: boolean): void;
};

// 首页只借用原消息/材料子树的展示，不接管读取、选材或正文权威状态。
export const HomePreview = createContext<{
  target: HTMLElement | null;
  session: string;
  enabled: boolean;
  owner: string | null;
  begin(entry: HomePreviewEntry): number;
  show(entry: HomePreviewEntry, ticket: number): void;
  release(owner: string): void;
} | null>(null);
export const useHomePreview = () => useContext(HomePreview);
