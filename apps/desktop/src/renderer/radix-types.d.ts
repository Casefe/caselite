// Radix 1.1.4的类型导出引用Node setImmediate。只补不可调用的类型占位，
// 不为沙箱Renderer引入Node全局类型或运行时polyfill；上游修复后删除。
declare function setImmediate(callback: never): never;
