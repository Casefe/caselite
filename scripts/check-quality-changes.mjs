import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import ts from 'typescript';
import { parse } from './lib/source-analysis.mjs';

function testTitles(source, file) {
  const titles = [];
  const tree = parse(source, file);
  function walk(node) {
    if (
      ts.isCallExpression(node) &&
      /^(?:it|test)(?:\.|\[|$)/.test(node.expression.getText(tree)) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      titles.push(node.arguments[0].text);
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return titles;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasRequiredPrQualityWorkflow(source) {
  let workflow;
  try {
    workflow = yaml.load(source);
  } catch {
    return false;
  }
  if (!isRecord(workflow) || !isRecord(workflow.on)) return false;
  const pullRequest = workflow.on.pull_request;
  if (pullRequest !== null && (!isRecord(pullRequest) || Object.keys(pullRequest).length))
    return false;
  if (!Object.hasOwn(workflow.on, 'pull_request')) return false;

  const quality = workflow.jobs?.quality;
  if (
    !isRecord(quality) ||
    !hasOnlyKeys(quality, ['name', 'runs-on', 'timeout-minutes', 'env', 'steps']) ||
    quality['runs-on'] !== 'ubuntu-latest'
  )
    return false;
  if (!Array.isArray(quality.steps)) return false;
  const ciStep = quality.steps.find((step) => isRecord(step) && step.run === 'pnpm run ci');
  const evidenceStep = quality.steps.find(
    (step) => isRecord(step) && step.name === 'Upload quality evidence',
  );
  return Boolean(
    ciStep &&
    hasOnlyKeys(ciStep, ['run']) &&
    evidenceStep &&
    hasOnlyKeys(evidenceStep, ['name', 'if', 'uses', 'with']) &&
    evidenceStep.if === 'always()' &&
    evidenceStep.uses === 'actions/upload-artifact@v7' &&
    isRecord(evidenceStep.with) &&
    hasOnlyKeys(evidenceStep.with, ['name', 'path', 'if-no-files-found']) &&
    evidenceStep.with.name === 'quality-evidence' &&
    evidenceStep.with?.path === 'artifacts/evidence/g0-ci-*.json' &&
    evidenceStep.with?.['if-no-files-found'] === 'error',
  );
}

function isRuleDocument(file) {
  return (
    /(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$/i.test(file) ||
    /^(?:README\.md|docs\/(?:CODE_REVIEW|WORKFLOW|SOURCES|DEVELOPMENT|TESTING|SECURITY|ARCHITECTURE|REVIEW_HANDOFF_EXERCISE)\.md)$/i.test(
      file,
    ) ||
    /^docs\/(?:adr|architecture|security)\/.*\.md$/i.test(file) ||
    /^\.github\/.*\.md$/i.test(file)
  );
}

export function isReviewableFile(file) {
  return /\.(?:[cm]?[jt]sx?|json|ya?ml|md)$/i.test(file) || isRegressionInput(file);
}

function isRegressionInput(file) {
  return (
    isRuleDocument(file) ||
    /^(?:\.claude|\.codex|\.agents|\.github|scripts)\//.test(file) ||
    /(?:^|\/)package\.json$/.test(file) ||
    /(?:^|\/)(?:(?:eslint|vitest|prettier)[^/]*\.[cm]?[jt]s|tsconfig[^/]*\.json|pnpm-[^/]*\.ya?ml|\.secretlintrc\.json|\.?mise\.toml|\.node-version|\.nvmrc|\.prettierignore|\.gitignore|\.npmrc|\.eslintignore)$/.test(
      file,
    ) ||
    /^(?:apps\/desktop\/(?:forge|webpack)|tests\/contracts\/quality-gate-failures\.test\.ts$)/.test(
      file,
    )
  );
}

export const regressionCases = [
  'rule-discovery',
  'unsafe-change-rejection',
  'stale-evidence-rejection',
];

export function validateRegression(evidence, rulesSha256) {
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  if (!isRecord(evidence) || evidence.version !== 1)
    return ['Regression evidence missing or invalid'];
  const violations = [];
  if (evidence.rulesSha256 !== rulesSha256) violations.push('Regression evidence is stale');
  if (
    !nonempty(evidence.authorSession) ||
    !nonempty(evidence.reviewerSession) ||
    evidence.authorSession.trim() === evidence.reviewerSession.trim() ||
    evidence.context !== 'fresh' ||
    !nonempty(evidence.model)
  )
    violations.push('Independent fresh-context identity missing');
  if (!Array.isArray(evidence.cases) || evidence.cases.length !== regressionCases.length)
    violations.push('Required regression cases missing');
  for (const id of regressionCases) {
    const cases = Array.isArray(evidence.cases)
      ? evidence.cases.filter((item) => item?.id === id)
      : [];
    if (
      cases.length !== 1 ||
      cases[0].status !== 'PASS_REAL' ||
      !nonempty(cases[0].evidence) ||
      !/^[a-f0-9]{64}$/.test(cases[0].sha256 ?? '')
    )
      violations.push(`Regression case not verified: ${id}`);
  }
  return violations;
}

function isTestFile(file) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file);
}

export function reviewChanges(changes) {
  const violations = [];
  const protectedFiles = changes
    .filter(
      ({ file }) =>
        /^(?:scripts\/|\.github\/|eslint|vitest|prettier|package\.json|pnpm-|\.secretlint|apps\/desktop\/(?:forge|webpack))/.test(
          file,
        ) ||
        isTestFile(file) ||
        isRuleDocument(file) ||
        isRegressionInput(file),
    )
    .map(({ file }) => file);
  const oldTitles = changes.flatMap(({ file, before }) =>
    isTestFile(file) ? testTitles(before, file) : [],
  );
  const newTitles = changes.flatMap(({ file, after }) =>
    isTestFile(file) ? testTitles(after, file) : [],
  );
  const remaining = new Map();
  for (const title of newTitles) remaining.set(title, (remaining.get(title) ?? 0) + 1);
  for (const title of oldTitles) {
    if ((remaining.get(title) ?? 0) === 0) violations.push(`Test removed: ${title}`);
    else remaining.set(title, remaining.get(title) - 1);
  }
  for (const { file, before, after } of changes) {
    // 规则正文的语义由独立审查负责；删除或清空不能以机器检查通过代替批准。
    if (isRuleDocument(file) && before.trim() && !after.trim())
      violations.push(`Protected rule document removed or emptied: ${file}`);
    if (file === 'package.json') {
      const oldScripts = JSON.parse(before || '{}').scripts ?? {};
      const scripts = JSON.parse(after || '{}').scripts ?? {};
      for (const name of [
        'security:baseline',
        'security:public',
        'security:electron',
        'security:logs',
        'security:secrets',
        'architecture:check',
        'test:integrity',
        'test:contracts',
        'test:integration',
        'review:changes',
        'licenses:report',
        'audit:dependencies',
        'coverage',
        'ci',
      ]) {
        if (oldScripts[name] && !scripts[name]) violations.push(`Required script removed: ${name}`);
        else if (oldScripts[name] && scripts[name] !== oldScripts[name])
          violations.push(`Required script command changed; explicit review required: ${name}`);
      }
      for (const name of [
        'security:public',
        'security:electron',
        'security:logs',
        'security:secrets',
      ])
        if (
          oldScripts['security:baseline']?.includes(name) &&
          !scripts['security:baseline']?.includes(name)
        )
          violations.push(`Security chain removed: ${name}`);
    }
    if (file === '.github/workflows/quality.yml' && !hasRequiredPrQualityWorkflow(after))
      violations.push(
        `Required PR quality workflow missing an active CI step or required evidence: ${file}`,
      );
    if (file === 'scripts/run-quality-gate.mjs') {
      for (const step of [
        'format:check',
        'lint',
        'architecture:check',
        'test:integrity',
        'security:baseline',
        'typecheck',
        'test:unit',
        'test:contracts',
        'audit:dependencies',
        'licenses:report',
        'test:integration',
        'package',
      ]) {
        if (before.includes(`'${step}'`) && !after.includes(`'${step}'`))
          violations.push(`Required gate step removed: ${step}`);
      }
    }
    if (/vitest.*config\.[cm]?[jt]s$/i.test(file)) {
      // Any reduction of an existing literal threshold must fail. Other config
      // changes remain in the explicit review report (including expressions).
      for (const key of ['statements', 'branches', 'functions', 'lines']) {
        const expression = new RegExp(`\\b${key}\\s*:\\s*(\\d+(?:\\.\\d+)?)`);
        const oldValue = before.match(expression)?.[1];
        const newValue = after.match(expression)?.[1];
        if (oldValue && (!newValue || Number(newValue) < Number(oldValue)))
          violations.push(`Coverage threshold removed or lowered: ${key}`);
      }
    }
  }
  return { violations, protectedFiles, reviewRequired: protectedFiles.length > 0 };
}

export function collectChanges(root, baseRef) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const base = git(['rev-parse', '--verify', `${baseRef}^{commit}`]).trim();
  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const oldFiles = git(['ls-tree', '-r', '--name-only', '-z', base]).split('\0').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);
  const changes = [];
  for (const file of new Set([...tracked, ...oldFiles, ...untracked])) {
    if (!isReviewableFile(file)) continue;
    let before = '';
    if (oldFiles.includes(file)) before = git(['show', `${base}:${file}`]);
    const after = existsSync(resolve(root, file)) ? readFileSync(resolve(root, file), 'utf8') : '';
    if (before !== after) changes.push({ file, before, after });
  }
  // 指纹绑定当前规则及检查器，正文/UI普通修改不会令独立规则演练无条件失效。
  const rulesHash = createHash('sha256');
  const ruleFiles = [...new Set([...tracked, ...untracked])].filter(isRegressionInput).sort();
  for (const file of ruleFiles) {
    const path = resolve(root, file);
    if (existsSync(path) && !lstatSync(path).isFile())
      throw new Error('Rule input must be a regular file');
    rulesHash
      .update(file)
      .update('\0')
      .update(existsSync(path) ? readFileSync(path) : '<deleted>')
      .update('\0');
  }
  return { base, changes, rulesSha256: rulesHash.digest('hex') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..');
  const { base, changes, rulesSha256 } = collectChanges(
    root,
    process.env.QUALITY_BASE_REF || 'origin/main',
  );
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const requireRegression = args[0] === '--require-regression';
  if (args.length && (!requireRegression || args.length > 2))
    throw new Error('Unknown review arguments');
  const report = {
    base,
    ...reviewChanges(changes),
    diffSha256: createHash('sha256').update(JSON.stringify(changes)).digest('hex'),
    regression: {
      required: changes.some(({ file }) => isRegressionInput(file)),
      rulesSha256,
      status: 'NOT_RUN',
    },
  };
  if (requireRegression) {
    let evidence;
    try {
      evidence = JSON.parse(readFileSync(resolve(root, args[1] ?? ''), 'utf8'));
      const errors = validateRegression(evidence, rulesSha256);
      for (const item of evidence.cases ?? []) {
        if (errors.length) break;
        const path = resolve(root, item.evidence);
        if (
          !lstatSync(path).isFile() ||
          createHash('sha256').update(readFileSync(path)).digest('hex') !== item.sha256
        )
          errors.push('Regression artifact missing or changed');
      }
      report.violations.push(...errors);
      report.regression.status = errors.length ? 'BLOCKED' : 'PASS_REAL';
    } catch {
      report.violations.push('Regression evidence or artifact unreadable');
      report.regression.status = 'BLOCKED';
    }
  }
  mkdirSync(resolve(root, 'artifacts/evidence'), { recursive: true });
  writeFileSync(
    resolve(root, 'artifacts/evidence/quality-change-review.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (report.reviewRequired)
    console.log(
      `REVIEW REQUIRED: ${report.protectedFiles.join(', ')}. Review the exact diff before merging; this report does not grant approval.`,
    );
  if (report.regression.required && report.regression.status !== 'PASS_REAL')
    console.log(
      'REGRESSION REQUIRED: follow docs/REVIEW_HANDOFF_EXERCISE.md before delivery; ordinary checks do not approve it.',
    );
  if (report.violations.length) {
    console.error(report.violations.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      'Quality change check passed: no detected rule/test deletion or required gate removal.',
    );
}
