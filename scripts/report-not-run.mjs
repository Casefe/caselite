const [check] = process.argv.slice(2);

const reasons = {
  e2e: 'NOT RUN: The packaged desktop E2E harness requires an interactive macOS Apple Silicon host. Linux CI cannot run that application; pnpm test:full runs it locally after packaging. Playwright remains deferred to preserve the security Fuse.',
  integration:
    'NOT RUN: SQLite, files and typed IPC are not implemented yet. Their integration tests begin with DEV-1567, DEV-1568 and DEV-1578.',
};

if (!reasons[check]) {
  console.error(`Unknown deferred check: ${check ?? '(missing)'}`);
  process.exitCode = 1;
} else {
  console.log(reasons[check]);
}
