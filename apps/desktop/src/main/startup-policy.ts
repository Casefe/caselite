// 本地测试豁免只接收编译期标记；协议专项演练仍经过真实协议窗口。
export function needsLegalConsent(localTestBuild: boolean, demoPhase?: string) {
  return !localTestBuild || Boolean(demoPhase?.startsWith('legal-'));
}
