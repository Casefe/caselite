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

export function summarizeEvidence(records) {
  const groups = new Map();
  const excluded = [];
  const errors = [];
  const seen = new Map();
  const conflicts = new Set();
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  for (const { file, evidence, error } of records) {
    if (
      error ||
      !evidence ||
      !['quick', 'ci', 'full'].includes(evidence.mode) ||
      !nonempty(evidence.startedAt) ||
      !Number.isFinite(Date.parse(evidence.startedAt)) ||
      !Array.isArray(evidence.results) ||
      !evidence.results.length ||
      !evidence.results.every(
        (item) =>
          item &&
          nonempty(item.name) &&
          nonempty(item.command) &&
          ['passed', 'failed', 'not-run'].includes(item.status) &&
          Number.isFinite(item.durationMs) &&
          item.durationMs >= 0,
      )
    ) {
      errors.push({ file, reason: 'Unreadable or invalid quality evidence' });
      continue;
    }
    if (
      [evidence.worktreeSha256, evidence.lockfileSha256].some(
        (value) =>
          value !== undefined && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)),
      )
    ) {
      errors.push({ file, reason: 'Invalid input snapshot' });
      continue;
    }
    // 旧记录缺少快照时无法核对输入，保留来源但不混入可比较样本。
    if (evidence.worktreeSha256 === undefined || evidence.lockfileSha256 === undefined) {
      excluded.push({ file, reason: 'Missing input snapshot (legacy or incomplete record)' });
      continue;
    }
    const failed = evidence.results.some((item) => item.status === 'failed');
    if (
      evidence.status !== (failed ? 'failed' : 'passed-with-limitations') ||
      !nonempty(evidence.node) ||
      !nonempty(evidence.pnpm) ||
      (evidence.platform !== undefined && !nonempty(evidence.platform)) ||
      (evidence.arch !== undefined && !nonempty(evidence.arch)) ||
      !evidence.results.every((item) => {
        if (item.exitCode !== null && !Number.isInteger(item.exitCode)) return false;
        if (item.signal !== null && !nonempty(item.signal)) return false;
        if (item.executionError !== undefined && !nonempty(item.executionError)) return false;
        const cleanExit = item.exitCode === 0 && !item.signal && !item.executionError;
        if (item.status === 'passed') return cleanExit;
        if (item.status === 'failed') return !cleanExit;
        return (
          (item.exitCode === null || item.exitCode === 0) && !item.signal && !item.executionError
        );
      })
    ) {
      errors.push({
        file,
        reason: 'Inconsistent result, invalid snapshot or missing tool version',
      });
      continue;
    }
    const environment = {
      mode: evidence.mode,
      node: evidence.node,
      pnpm: evidence.pnpm,
      platform: evidence.platform ?? 'UNKNOWN',
      arch: evidence.arch ?? 'UNKNOWN',
      lockfileSha256: evidence.lockfileSha256,
      plan: evidence.results.map(({ name, command }) => ({ name, command })),
    };
    const key = JSON.stringify(environment);
    const runKey = JSON.stringify([key, evidence.startedAt, evidence.worktreeSha256]);
    const content = JSON.stringify(evidence, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
    );
    if (seen.has(runKey)) {
      if (seen.get(runKey).content !== content) {
        conflicts.add(runKey);
        errors.push({
          file,
          conflictsWith: seen.get(runKey).file,
          reason: 'Conflicting run identity',
        });
      } else excluded.push({ file, reason: 'Duplicate run identity' });
      continue;
    }
    seen.set(runKey, { file, evidence, environment, content });
  }
  // 相同运行标识内容冲突时整组排除，不能先到先赢而隐藏失败。
  const accepted = [...seen.entries()]
    .filter(([key]) => !conflicts.has(key))
    .map(([, value]) => value);
  for (const { file, evidence, environment } of accepted) {
    const key = JSON.stringify(environment);
    const failed = evidence.results.some((item) => item.status === 'failed');
    let group = groups.get(key);
    if (!group) {
      group = {
        environment,
        sourceFiles: [],
        firstRunAt: evidence.startedAt,
        lastRunAt: evidence.startedAt,
        failedRuns: 0,
        runsWithUnexecutedChecks: 0,
        completedRuns: 0,
        historicalCheckFailures: new Map(),
        durations: [],
        snapshots: new Set(),
      };
      groups.set(key, group);
    }
    group.sourceFiles.push(file);
    group.snapshots.add(evidence.worktreeSha256);
    if (Date.parse(evidence.startedAt) < Date.parse(group.firstRunAt))
      group.firstRunAt = evidence.startedAt;
    if (Date.parse(evidence.startedAt) > Date.parse(group.lastRunAt))
      group.lastRunAt = evidence.startedAt;
    const unexecuted = evidence.results.some((item) => item.status === 'not-run');
    if (failed) group.failedRuns++;
    if (unexecuted) group.runsWithUnexecutedChecks++;
    if (!failed && !unexecuted) {
      group.completedRuns++;
      group.durations.push(evidence.results.reduce((sum, item) => sum + item.durationMs, 0));
    }
    for (const item of evidence.results.filter((item) => item.status === 'failed'))
      group.historicalCheckFailures.set(
        item.name,
        (group.historicalCheckFailures.get(item.name) ?? 0) + 1,
      );
  }
  return {
    status: errors.length ? 'PARTIAL' : accepted.length ? 'AVAILABLE' : 'NOT_RUN',
    inputFiles: records.length,
    includedRuns: accepted.length,
    excluded,
    errors,
    groups: [...groups.values()].map(
      ({ durations, snapshots, historicalCheckFailures, ...group }) => {
        durations.sort((a, b) => a - b);
        const middle = Math.floor(durations.length / 2);
        return {
          ...group,
          runCount: group.sourceFiles.length,
          inputSnapshots: snapshots.size,
          completedRunMedianCheckMs: durations.length
            ? durations.length % 2
              ? durations[middle]
              : (durations[middle - 1] + durations[middle]) / 2
            : null,
          historicalCheckFailures: Object.fromEntries(historicalCheckFailures),
        };
      },
    ),
    outcomeMetrics: {
      acceptedTaskCycleTime: 'UNKNOWN',
      reviewWaitingTime: 'UNKNOWN',
      humanRework: 'UNKNOWN',
      toolUsageAndCost: 'UNKNOWN',
    },
    limitations: [
      'Local historical runs only; repeated runs are not accepted tasks or proof of LLM effectiveness.',
      'Failure and unexecuted counts may overlap. Completed checks retain all original acceptance limitations.',
      'Durations sum executed checks, not end-to-end delivery time; compare only equivalent inputs and outcomes.',
      'Missing historical platform/architecture remain UNKNOWN. Task outcomes and costs belong in the existing Issue handoff.',
    ],
  };
}
