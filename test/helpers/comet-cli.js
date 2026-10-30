import { spawnSync } from 'node:child_process';

// Node and the PATH-selected global Comet need not share a directory.
export function resolveCometForTest() {
  const found=spawnSync('which',['comet'],{encoding:'utf8'});
  if (found.status!==0 || !found.stdout.trim()) throw new Error('Comet 0.5.1 is required on PATH');
  const comet=found.stdout.trim();
  const version=spawnSync(comet,['--version'],{encoding:'utf8'});
  if (version.status!==0 || version.stdout.trim()!=='0.5.1') throw new Error('the PATH-selected Comet must be 0.5.1');
  return comet;
}
