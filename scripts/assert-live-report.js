#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function reportArg(argv) {
  const index = argv.indexOf('--report');
  if (index === -1 || !argv[index + 1]) throw new Error('--report is required');
  return path.resolve(argv[index + 1]);
}

try {
  const reportPath = reportArg(process.argv.slice(2));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const failures = [];
  if (report.schemaVersion !== 1) failures.push('schemaVersion must be 1');
  if (report.mode !== 'finalize') failures.push('mode must be finalize');
  if (report.pass !== true) failures.push('report.pass is not true');
  if (report.fixtureHashBefore !== report.fixtureHashAfter) failures.push('source fixture hash changed');
  if (report.workflow?.current !== 'archive') failures.push('workflow is not at archive');
  if (report.workflow?.runStatus !== 'completed') failures.push('workflow is not completed');
  if (!Array.isArray(report.capabilities) || report.capabilities.some((item) => item.pass !== true)) {
    failures.push('one or more capability receipts did not pass');
  }
  if (!Array.isArray(report.issues) || report.issues.length !== 0) {
    failures.push('report contains issues');
  }

  const result = { schemaVersion: 1, pass: failures.length === 0, reportPath, failures };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.pass) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
