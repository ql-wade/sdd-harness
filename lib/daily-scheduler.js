import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// ============================================================================
// Daily UA Graph Refresh — 定时刷新 Understand-Anything 知识图谱
// ============================================================================

const LAUNCH_AGENT_LABEL = 'com.sdd-harness.graph-refresh';

/**
 * Install a macOS launchd job for daily UA graph refresh.
 * On Linux, writes a cron entry.
 */
export async function installDailyGraphRefresh(cwd) {
  const homeDir = os.homedir();
  const sddHome = path.join(homeDir, '.sdd');
  const scriptPath = path.join(sddHome, 'scripts', 'daily-graph-refresh.sh');

  // Write the refresh script
  await fs.ensureDir(path.dirname(scriptPath));
  await fs.writeFile(scriptPath, `#!/bin/bash
# Daily UA graph refresh — triggered by launchd/cron
# Runs sdd graph --refresh in the target project directory
set -euo pipefail

PROJECT_DIR="${cwd}"
LOG_FILE="${path.join(sddHome, 'logs', 'graph-refresh.log')}"

mkdir -p "$(dirname "$LOG_FILE")"

echo "$(date -Iseconds) Starting daily UA graph refresh..." >> "$LOG_FILE"

# Run sdd graph --refresh (which triggers /understand via claude -p)
cd "$PROJECT_DIR"
sdd graph --refresh >> "$LOG_FILE" 2>&1 || {
  echo "$(date -Iseconds) WARNING: sdd graph --refresh failed" >> "$LOG_FILE"
}

echo "$(date -Iseconds) Daily refresh complete." >> "$LOG_FILE"
`);
  await fs.chmod(scriptPath, 0o755);

  if (process.platform === 'darwin') {
    // macOS: launchd LaunchAgent
    const launchDir = path.join(homeDir, 'Library', 'LaunchAgents');
    await fs.ensureDir(launchDir);
    const plistPath = path.join(launchDir, `${LAUNCH_AGENT_LABEL}.plist`);

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${scriptPath}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>2</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(sddHome, 'logs', 'graph-refresh-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(sddHome, 'logs', 'graph-refresh-stderr.log')}</string>
</dict>
</plist>`;

    await fs.writeFile(plistPath, plist);

    // Load the LaunchAgent
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`);
      execSync(`launchctl load "${plistPath}"`);
    } catch {}

    return { platform: 'darwin', plistPath, scriptPath, schedule: 'daily 02:00' };
  } else {
    // Linux: cron
    const cronEntry = `0 2 * * * /bin/bash ${scriptPath}`;
    try {
      const existing = execSync('crontab -l 2>/dev/null || true', { encoding: 'utf8' });
      if (!existing.includes(LAUNCH_AGENT_LABEL)) {
        execSync(`(echo "${existing}"; echo "# ${LAUNCH_AGENT_LABEL}"; echo "${cronEntry}") | crontab -`);
      }
    } catch {}
    return { platform: 'linux', scriptPath, schedule: 'daily 02:00' };
  }
}

/**
 * Remove the daily UA graph refresh job.
 */
export async function uninstallDailyGraphRefresh() {
  const homeDir = os.homedir();

  if (process.platform === 'darwin') {
    const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
    try { execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`); } catch {}
    await fs.remove(plistPath).catch(() => {});
    return { removed: true, platform: 'darwin' };
  } else {
    // Remove cron entry
    try {
      const existing = execSync('crontab -l 2>/dev/null || true', { encoding: 'utf8' });
      const cleaned = existing.split('\n')
        .filter(line => !line.includes(LAUNCH_AGENT_LABEL) && !line.includes('daily-graph-refresh.sh'))
        .join('\n');
      execSync(`echo "${cleaned}" | crontab -`);
    } catch {}
    return { removed: true, platform: 'linux' };
  }
}

/**
 * Check if the daily refresh is installed.
 */
export async function checkDailyGraphRefresh() {
  const homeDir = os.homedir();

  if (process.platform === 'darwin') {
    const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
    const exists = await fs.pathExists(plistPath);
    if (exists) {
      return { installed: true, platform: 'darwin', plistPath };
    }
  } else {
    try {
      const crontab = execSync('crontab -l 2>/dev/null || true', { encoding: 'utf8' });
      if (crontab.includes('daily-graph-refresh.sh')) {
        return { installed: true, platform: 'linux' };
      }
    } catch {}
  }

  return { installed: false };
}
