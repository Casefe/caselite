import { resolvePropertyPanel, type PropertyField } from '../../shared/ui/property-panel-config';

export type ContactField =
  'name' | 'kind' | 'company' | 'position' | 'phone' | 'wechat' | 'email' | 'address' | 'tags';

const definitions: readonly PropertyField<ContactField>[] = [
  { id: 'name', label: '姓名／名称', maxLength: 120 },
  { id: 'kind', label: '类型' },
  { id: 'company', label: '单位', maxLength: 160 },
  { id: 'position', label: '职务', maxLength: 80 },
  { id: 'phone', label: '电话', maxLength: 64 },
  { id: 'wechat', label: '微信', maxLength: 80 },
  { id: 'email', label: '邮箱', maxLength: 254 },
  { id: 'address', label: '地址', maxLength: 500 },
  { id: 'tags', label: '标签' },
];
const page = { fieldIds: definitions.map(({ id }) => id) };
export const contactPropertyPage = resolvePropertyPanel(definitions, page);
// 详情沿用一级页的九字段；资料分组不是导航子页，不能截断详情的元数据与 Tab 顺序。
export const contactPropertyDetail = resolvePropertyPanel(definitions, page, {});
export const contactFactFields = [
  'phone',
  'wechat',
  'email',
  'address',
] as const satisfies readonly ContactField[];
