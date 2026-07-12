import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// SDD home 目录：$SDD_HOME 优先，否则 ~/.sdd。所有 ~/.sdd 引用都走这里，支持 env 覆盖。
export function getSddHome() {
  return process.env.SDD_HOME || path.join(os.homedir(), '.sdd');
}

// Project slug：从 git common-dir 推导主仓库目录名——worktree-safe。
// 同一 repo 的所有 worktree 得到同一 slug → 共享同一 wiki（不随 worktree 生灭）。
// 无 git / 无 worktree 时 fallback 到 cwd basename。
function getProjectSlug(cwd) {
  try {
    const common = execSync(
      `git -C ${JSON.stringify(cwd)} rev-parse --git-common-dir`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    if (common) {
      const mainRepo = path.resolve(cwd, common, '..');
      const base = path.basename(mainRepo);
      if (base && base !== '.') return base.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    }
  } catch {}
  return (path.basename(cwd) || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

// LLMWiki home：$SDD_WIKI_HOME 优先，否则 $SDD_HOME/wiki/<project-slug>。
// worktree 共享：同一 repo 的所有 worktree 指向同一 wiki。
// 落点在 repo 树之外（~/.sdd/wiki/），不随 worktree 删除而丢——适合 worktree-dev 模式。
export function getWikiHome(cwd) {
  if (process.env.SDD_WIKI_HOME) return process.env.SDD_WIKI_HOME;
  return path.join(getSddHome(), 'wiki', getProjectSlug(cwd));
}
