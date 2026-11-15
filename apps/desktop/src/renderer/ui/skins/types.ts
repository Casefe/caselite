import type { SkinId } from '../../../preload/caselite-api';

export type SkinDefinition = {
  readonly id: SkinId;
  readonly name: string;
  readonly description: string;
  readonly navigationOrder: readonly string[];
};
