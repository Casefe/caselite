// New third-party licenses require review. This does not license CaseLite itself.
const admitted = new Set(['MIT', 'Apache-2.0']);

// ADR-008：仅准入本次已阅读许可的精确版本；升级或其他依赖仍须审查。
const reviewed = new Set([
  '@ungap/structured-clone@1.4.0:ISC',
  '@protobufjs/aspromise@1.1.2:BSD-3-Clause',
  '@protobufjs/base64@1.1.2:BSD-3-Clause',
  '@protobufjs/codegen@2.0.5:BSD-3-Clause',
  '@protobufjs/eventemitter@1.1.1:BSD-3-Clause',
  '@protobufjs/fetch@1.1.1:BSD-3-Clause',
  '@protobufjs/float@1.0.2:BSD-3-Clause',
  '@protobufjs/path@1.1.2:BSD-3-Clause',
  '@protobufjs/pool@1.1.0:BSD-3-Clause',
  '@protobufjs/utf8@1.1.2:BSD-3-Clause',
  'buffer-equal-constant-time@1.0.1:BSD-3-Clause',
  'fast-sha256@1.3.0:Unlicense',
  'protobufjs@7.6.6:BSD-3-Clause',
  'secure-json-parse@4.1.1:BSD-3-Clause',
  'tslib@2.8.1:0BSD',
]);

export function licenseViolations(packages) {
  return packages
    .filter(
      (item) =>
        !item.workspace &&
        !admitted.has(item.license) &&
        !reviewed.has(`${item.name}@${item.version}:${item.license}`),
    )
    .map(
      (item) =>
        `${item.name}@${item.version}: license requires review (${typeof item.license === 'string' ? item.license : 'UNKNOWN'})`,
    );
}
