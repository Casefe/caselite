const [check] = process.argv.slice(2);

const reasons = {
  e2e: 'NOT RUN: Playwright Electron automation is deferred. The current security Fuse disables the Node inspect argument that Playwright requires; DEV-1559 must not weaken that Fuse merely to make this check green.',
  integration:
    'NOT RUN: SQLite, files and typed IPC are not implemented yet. Their integration tests begin with DEV-1567, DEV-1568 and DEV-1578.',
};

if (!reasons[check]) {
  console.error(`Unknown deferred check: ${check ?? '(missing)'}`);
  process.exitCode = 1;
} else {
  console.log(reasons[check]);
}
