import { expect, it } from 'vitest';
import {
  contactFactFields,
  contactPropertyDetail,
  contactPropertyPage,
} from './contact-property-config';

it('preserves all nine fields, labels, limits and Tab order on page and detail', () => {
  expect(contactPropertyPage.fields).toEqual([
    { id: 'name', label: '姓名／名称', maxLength: 120 },
    { id: 'kind', label: '类型' },
    { id: 'company', label: '单位', maxLength: 160 },
    { id: 'position', label: '职务', maxLength: 80 },
    { id: 'phone', label: '电话', maxLength: 64 },
    { id: 'wechat', label: '微信', maxLength: 80 },
    { id: 'email', label: '邮箱', maxLength: 254 },
    { id: 'address', label: '地址', maxLength: 500 },
    { id: 'tags', label: '标签' },
  ]);
  expect(contactPropertyDetail.fields).toEqual(contactPropertyPage.fields);
  expect(contactPropertyDetail).not.toBe(contactPropertyPage);
  expect(contactPropertyDetail.style).toEqual(contactPropertyPage.style);
  expect(contactPropertyPage.style).toEqual({
    fontSize: '12px',
    smallFontSize: '11px',
    gap: '7px',
  });
});

it('keeps the four facts in their original group independently of page and detail fields', () => {
  expect(contactFactFields).toEqual(['phone', 'wechat', 'email', 'address']);
  expect(contactFactFields).not.toEqual(contactPropertyPage.fields.map(({ id }) => id));
  expect(contactFactFields).not.toEqual(contactPropertyDetail.fields.map(({ id }) => id));
});
