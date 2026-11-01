export function executePlan(plan, execute) {
  let failed = false;
  return plan.map(([name, args, presetStatus]) => {
    const command = ['pnpm', ...args].join(' ');
    if (failed)
      return {
        name,
        command,
        status: 'not-run',
        reason: 'An earlier required check failed.',
        durationMs: 0,
        exitCode: null,
        signal: null,
      };
    const started = Date.now();
    const result = execute(args);
    const status = result.status === 0 && !result.error ? (presetStatus ?? 'passed') : 'failed';
    failed = status === 'failed';
    return {
      name,
      command,
      status,
      durationMs: Date.now() - started,
      exitCode: result.status,
      signal: result.signal ?? null,
      ...(result.error ? { executionError: result.error.code ?? 'SPAWN_FAILED' } : {}),
    };
  });
}
