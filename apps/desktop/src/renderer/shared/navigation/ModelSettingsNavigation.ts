import { createContext } from 'react';

// 导航契约独立于设置页面，调用方只请求打开模型设置，不持有设置状态。
export const ModelSettingsNavigation = createContext<(() => void) | null>(null);
