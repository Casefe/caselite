import type { SkinId } from '../../../preload/caselite-api';
import { deepSeaSkin } from './deep-sea';
import { lilacSkin } from './lilac';
import { paperSkin } from './paper';
import { pineSkin } from './pine';
export type { SkinDefinition } from './types';

export const skins = [deepSeaSkin, lilacSkin, paperSkin, pineSkin] as const;
export function findSkin(id: SkinId | undefined) {
  return skins.find((skin) => skin.id === id);
}

export function orderSkinNavigation<T extends { id: string }>(
  items: readonly T[],
  id?: SkinId,
): T[] {
  const order: readonly string[] | undefined = findSkin(id)?.navigationOrder;
  if (!order) return [...items];
  const rank = (value: string) => {
    const position = order.indexOf(value);
    return position === -1 ? order.length : position;
  };
  // 未知的新入口稳定留在末尾，不因皮肤配置缺项隐藏功能或改变对象身份。
  return [...items].sort((left, right) => rank(left.id) - rank(right.id));
}
