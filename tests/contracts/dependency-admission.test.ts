import { describe, expect, it } from 'vitest';

import {
  dependencyViolations,
  runtimeDependencyViolation,
} from '../../scripts/lib/dependency-admission.mjs';

describe('production dependency admission', () => {
  it('rejects an unapproved OCR, MCP or alternate runtime before production use', () => {
    for (const name of ['tesseract.js', '@modelcontextprotocol/sdk', 'langgraph']) {
      expect(
        dependencyViolations([{ folder: 'apps/desktop', dependencies: { [name]: '1.0.0' } }]),
      ).toEqual([expect.stringContaining(`requires admission: ${name}@1.0.0`)]);
    }
  });

  it('checks exact versions, consumers, root, optional and peer dependencies', () => {
    expect(
      dependencyViolations([
        { folder: 'apps/desktop', dependencies: { '@earendil-works/pi-ai': '1.5.0' } },
      ]),
    ).toEqual([]);
    for (const manifest of [
      { folder: 'apps/desktop', dependencies: { '@earendil-works/pi-ai': '^1.5.0' } },
      { folder: 'packages/application', dependencies: { '@earendil-works/pi-ai': '1.5.0' } },
      { folder: '.', dependencies: { 'tesseract.js': '1.0.0' } },
      { folder: 'apps/desktop', optionalDependencies: { 'tesseract.js': '1.0.0' } },
      { folder: 'apps/desktop', peerDependencies: { 'tesseract.js': '1.0.0' } },
    ]) {
      expect(dependencyViolations([manifest])).toHaveLength(1);
    }
  });

  it('does not let devDependencies become unadmitted product runtime imports', () => {
    const manifest = {
      folder: 'apps/desktop',
      devDependencies: { 'tesseract.js': '1.0.0', electron: '45.1.0' },
    };
    expect(runtimeDependencyViolation(manifest, 'tesseract.js')).toContain('requires production');
    expect(runtimeDependencyViolation(manifest, 'electron')).toBeNull();
  });
});
