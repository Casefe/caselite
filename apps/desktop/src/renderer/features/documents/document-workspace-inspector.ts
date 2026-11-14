// 使用既有页面身份确定首次展示，不能借标题或文件名推断对象权限。
export function documentInspectorStartsCollapsed(pageKey: string): boolean {
  return (
    /^documents:(?!list$).+/.test(pageKey) ||
    /^projects:[^:]+:documents$/.test(pageKey) ||
    /^(?:tasks|calendar):[^:]+:document:成果正文$/.test(pageKey)
  );
}
