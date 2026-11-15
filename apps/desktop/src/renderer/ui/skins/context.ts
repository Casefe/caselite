import { createContext, useContext } from 'react';
import type { SkinId } from '../../../preload/caselite-api';

// 只广播Appearance原Owner已确认的值，无独立状态或存储；旧工作区消费者缺省沿原版。
export const SkinContext = createContext<SkinId | undefined>(undefined);
export const useSkin = () => useContext(SkinContext);
