// 阅读与提取共享预算，超限明确失败，不能静默丢图后当作完整材料。
export const PDF_BUDGET = {
  maxImageSize: 16_000_000,
  canvasMaxAreaInBytes: 32_000_000,
  stopAtErrors: true,
};
export const PDF_CANVAS_PIXELS = 8_000_000;
