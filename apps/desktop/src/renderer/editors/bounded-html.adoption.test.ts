// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { assertBoundedHtml } from './bounded-html';

// DEV-1845：独立合成输入固定资源边界；不复用上游样本或实现。
it.each([
  ['整表100列边界', '<table><tr><td colspan="100">边界</td></tr></table>'],
  [
    '跨两行的完整网格',
    '<table><tr><td rowspan="2">甲</td><td>乙</td></tr><tr><td>丙</td></tr></table>',
  ],
])('accepts the supported boundary: %s', (_name, input) => {
  expect(assertBoundedHtml(input)).toBe(true);
});

it.each([
  ['超过100列', '<table><tr><td colspan="101">超限</td></tr></table>'],
  [
    '跨行单元格相交',
    '<table><tr><td>甲</td><td rowspan="2">乙</td></tr><tr><td colspan="2">丙</td></tr></table>',
  ],
  ['零跨度', '<table><tr><td colspan="0">零</td></tr></table>'],
  ['负跨度', '<table><tr><td rowspan="-1">负</td></tr></table>'],
])('refuses malformed geometry before editor allocation: %s', (_name, input) => {
  expect(() => assertBoundedHtml(input)).toThrow();
});

it('refuses excessive nesting without modifying the active document DOM', () => {
  document.body.innerHTML = '<p id="saved">已保存正文</p>';
  const before = document.body.innerHTML;
  expect(() => assertBoundedHtml('<div>'.repeat(36) + '超深' + '</div>'.repeat(36))).toThrow();
  expect(document.body.innerHTML).toBe(before);
});
