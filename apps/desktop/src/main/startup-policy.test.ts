import { afterEach, expect, it, vi } from 'vitest';
import { needsLegalConsent } from './startup-policy';

afterEach(() => vi.unstubAllEnvs());
it('keeps the ordinary build gated even when a launch-time test variable is set', () => {
  vi.stubEnv('CASELITE_LOCAL_TEST_BUILD', '1');
  expect(needsLegalConsent(false)).toBe(true);
  expect(needsLegalConsent(false, 'project-write')).toBe(true);
});
it('opens local test builds directly but retains the real legal test path', () => {
  expect(needsLegalConsent(true)).toBe(false);
  expect(needsLegalConsent(true, 'project-write')).toBe(false);
  for (const phase of ['legal-accept', 'legal-reject', 'legal-write-failure', 'legal-read'])
    expect(needsLegalConsent(true, phase)).toBe(true);
});
