// New third-party licenses require review. This does not license CaseLite itself.
const admitted = new Set(['MIT', 'Apache-2.0']);

export function licenseViolations(packages) {
  return packages
    .filter((item) => !item.workspace && !admitted.has(item.license))
    .map(
      (item) =>
        `${item.name}@${item.version}: license requires review (${typeof item.license === 'string' ? item.license : 'UNKNOWN'})`,
    );
}
