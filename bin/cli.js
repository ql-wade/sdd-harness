#!/usr/bin/env node

import { program } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const VERSION = '2.5.0';

// 平台配置
const PLATFORMS = {
  claude: {
    name: 'Claude Code',
    skillsDir: '.claude/skills',
    commandsDir: '.claude/commands',
    templateDir: 'claude',
  },
  opencode: {
    name: 'OpenCode',
    skillsDir: '.opencode/skills',
    commandsDir: '.opencode/commands',
    templateDir: 'opencode',
  }
};

// 需要清理的旧命令文件
const LEGACY_COMMANDS = [
  'hybrid-new.md', 'hybrid-continue.md', 'hybrid-apply.md',
  'hybrid-verify.md', 'hybrid-archive.md', 'hybrid-status.md',
  'opsx-new.md', 'opsx-continue.md', 'opsx-apply.md',
  'opsx-verify.md', 'opsx-archive.md', 'opsx-status.md',
];

// 有效的 platform 参数值
const VALID_PLATFORMS = ['claude', 'opencode', 'both'];

// 自动检测平台
function detectPlatform(cwd) {
  const hasClaude = fs.existsSync(path.join(cwd, '.claude'));
  const hasOpencode = fs.existsSync(path.join(cwd, '.opencode'));

  if (hasClaude && hasOpencode) return 'both';
  if (hasClaude) return 'claude';
  if (hasOpencode) return 'opencode';
  return 'both'; // 默认双平台安装
}

// 复制 skills 目录
async function copySkills(cwd, platform, force, dryRun) {
  const config = PLATFORMS[platform];
  const destSkillsDir = path.join(cwd, config.skillsDir);
  const templateSkillsDir = path.join(TEMPLATES_DIR, config.templateDir, 'skills');

  if (!await fs.pathExists(templateSkillsDir)) return 0;

  if (dryRun) {
    const skills = (await fs.readdir(templateSkillsDir)).filter(async s => {
      const stat = await fs.stat(path.join(templateSkillsDir, s));
      return stat.isDirectory();
    });
    console.log(chalk.cyan(`  [dry-run] Would copy ${skills.length} skills to ${config.skillsDir}/`));
    return skills.length;
  }

  await fs.ensureDir(destSkillsDir);
  const skills = await fs.readdir(templateSkillsDir);
  let copied = 0;

  for (const skill of skills) {
    const src = path.join(templateSkillsDir, skill);
    const dest = path.join(destSkillsDir, skill);
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) continue;
    if (await fs.exists(dest) && !force) continue;

    await fs.copy(src, dest, { overwrite: force });
    copied++;
  }

  return copied;
}

// 复制 commands 目录
async function copyCommands(cwd, platform, force, dryRun) {
  const config = PLATFORMS[platform];
  if (!config.commandsDir) return 0;

  const destCommandsDir = path.join(cwd, config.commandsDir);
  const templateCommandsDir = path.join(TEMPLATES_DIR, config.templateDir, 'commands');

  if (!await fs.pathExists(templateCommandsDir)) return 0;

  if (dryRun) {
    const commands = (await fs.readdir(templateCommandsDir)).filter(async c => {
      const stat = await fs.stat(path.join(templateCommandsDir, c));
      return stat.isFile();
    });
    console.log(chalk.cyan(`  [dry-run] Would copy ${commands.length} commands to ${config.commandsDir}/`));
    return commands.length;
  }

  await fs.ensureDir(destCommandsDir);
  const commands = await fs.readdir(templateCommandsDir);
  let copied = 0;

  for (const cmd of commands) {
    const src = path.join(templateCommandsDir, cmd);
    const dest = path.join(destCommandsDir, cmd);
    const stat = await fs.stat(src);
    if (!stat.isFile()) continue;
    if (await fs.exists(dest) && !force) continue;

    await fs.copy(src, dest, { overwrite: force });
    copied++;
  }

  return copied;
}

// 清理旧命令文件
async function cleanupLegacyCommands(cwd, platforms, dryRun) {
  let cleaned = 0;

  for (const plat of platforms) {
    const config = PLATFORMS[plat];
    if (!config.commandsDir) continue;
    const commandsDir = path.join(cwd, config.commandsDir);

    if (!await fs.pathExists(commandsDir)) continue;

    const existing = await fs.readdir(commandsDir);
    for (const legacy of LEGACY_COMMANDS) {
      if (existing.includes(legacy)) {
        const filePath = path.join(commandsDir, legacy);
        if (dryRun) {
          console.log(chalk.cyan(`  [dry-run] Would remove: ${config.commandsDir}/${legacy}`));
        } else {
          await fs.remove(filePath);
          console.log(chalk.gray(`  ✓ Removed legacy: ${config.commandsDir}/${legacy}`));
        }
        cleaned++;
      }
    }
  }

  return cleaned;
}

program
  .name('sdd-cli')
  .description('SDD (Skill-Driven Development) CLI Tool - Trinity Workflow v2 (Claude Code + OpenCode)')
  .version(VERSION);

program
  .command('init')
  .description('Initialize SDD workflow configuration in current project')
  .option('-f, --force', 'Overwrite existing files', false)
  .option('--skip-schema', 'Skip copying schema files', false)
  .option('--skip-skills', 'Skip copying skill files', false)
  .option('--skip-commands', 'Skip copying command files', false)
  .option('--platform <name>', 'Target platform: claude | opencode | both (auto-detect by default)')
  .option('--dry-run', 'Preview changes without writing files', false)
  .action(async (options) => {
    const cwd = process.cwd();

    // P1#4: Platform 参数校验
    if (options.platform && !VALID_PLATFORMS.includes(options.platform)) {
      console.error(chalk.red(`\n❌ Invalid platform: "${options.platform}"`));
      console.error(chalk.red(`   Valid options: ${VALID_PLATFORMS.join(', ')}`));
      process.exit(1);
    }

    const detected = detectPlatform(cwd);
    const platform = options.platform || detected;

    // 确定要安装的平台列表
    const platformsToInstall = platform === 'both' ? ['claude', 'opencode'] : [platform];

    console.log(chalk.blue(`\n🚀 Initializing SDD workflow v${VERSION}...\n`));
    console.log(chalk.gray(`Detected: ${detected === 'both' ? 'Claude Code + OpenCode' : PLATFORMS[detected]?.name || 'Unknown'}`));
    console.log(chalk.gray(`Installing: ${platformsToInstall.map(p => PLATFORMS[p].name).join(' + ')}`));
    console.log(chalk.gray(`Schema: trinity-workflow-v2`));
    if (options.dryRun) {
      console.log(chalk.yellow(`Mode: DRY RUN (no files will be written)\n`));
    } else {
      console.log();
    }

    try {
      // 0. P0#3: 清理旧命令
      const legacyCount = await cleanupLegacyCommands(cwd, platformsToInstall, options.dryRun);
      if (legacyCount > 0 && !options.dryRun) {
        console.log(chalk.green(`✓ Cleaned ${legacyCount} legacy command(s)\n`));
      }

      // 1. Copy openspec config and schema (共享)
      if (!options.skipSchema) {
        const openspecDir = path.join(cwd, 'openspec');
        const schema = 'trinity-workflow-v2';

        if (options.dryRun) {
          console.log(chalk.cyan('[dry-run] Would create: openspec/config.yaml'));
          console.log(chalk.cyan(`[dry-run] Would create: openspec/schemas/${schema}/`));
        } else {
          await fs.ensureDir(path.join(openspecDir, 'schemas', schema));
          await fs.ensureDir(path.join(openspecDir, 'specs'));
          await fs.ensureDir(path.join(openspecDir, 'changes'));

          // Copy config.yaml
          const configSrc = path.join(TEMPLATES_DIR, 'openspec', 'config.yaml');
          const configDest = path.join(openspecDir, 'config.yaml');

          if (await fs.exists(configDest) && !options.force) {
            console.log(chalk.yellow('⚠ config.yaml already exists, use --force to overwrite'));
          } else {
            await fs.copy(configSrc, configDest);
            console.log(chalk.green('✓ Created openspec/config.yaml'));
          }

          // Copy entire schema directory
          const schemaSrcDir = path.join(TEMPLATES_DIR, 'openspec', 'schemas', schema);
          const schemaDestDir = path.join(openspecDir, 'schemas', schema);

          if (await fs.pathExists(schemaSrcDir)) {
            await fs.copy(schemaSrcDir, schemaDestDir, { overwrite: options.force });
            console.log(chalk.green(`✓ Created openspec/schemas/${schema}/`));
          }

          // Create .active file
          const activeFile = path.join(openspecDir, '.active');
          if (!await fs.exists(activeFile)) {
            await fs.writeFile(activeFile, '');
          }
        }
      }

      // 2. Copy skills + commands per platform
      if (!options.skipSkills || !options.skipCommands) {
        for (const plat of platformsToInstall) {
          const config = PLATFORMS[plat];
          console.log(chalk.gray(`\n📦 ${config.name}:`));

          if (!options.skipSkills) {
            const skillCount = await copySkills(cwd, plat, options.force, options.dryRun);
            if (skillCount > 0 && !options.dryRun) {
              console.log(chalk.green(`  ✓ Copied ${skillCount} skills to ${config.skillsDir}/`));
            } else if (!options.dryRun) {
              console.log(chalk.gray(`  - Skills already exist, skipping (use --force to overwrite)`));
            }
          }

          if (!options.skipCommands && config.commandsDir) {
            const cmdCount = await copyCommands(cwd, plat, options.force, options.dryRun);
            if (cmdCount > 0 && !options.dryRun) {
              console.log(chalk.green(`  ✓ Copied ${cmdCount} commands to ${config.commandsDir}/`));
            } else if (!options.dryRun) {
              console.log(chalk.gray(`  - Commands already exist, skipping`));
            }
          }
        }
      }

      console.log('\n' + chalk.green.bold(`✅ SDD workflow v${VERSION} initialized successfully!`));

      // Show available commands
      console.log('\n📚 Trinity Workflow v2 Commands:');
      console.log(chalk.cyan('   /trinity:new "描述"') + '      - 创建新变更（带追踪）');
      console.log(chalk.cyan('   /trinity:continue') + '        - 继续下一个 artifact');
      console.log(chalk.cyan('   /trinity:apply') + '           - 执行任务（3-Strike）');
      console.log(chalk.cyan('   /trinity:verify') + '          - 验证实现（三维度）');
      console.log(chalk.cyan('   /trinity:archive') + '         - 归档变更');
      console.log(chalk.cyan('   /trinity:ff "描述"') + '       - 快速流程\n');

      if (options.dryRun) {
        console.log(chalk.yellow('⚠ This was a dry run. No files were written.\n'));
      }

    } catch (error) {
      console.error(chalk.red('\n❌ Initialization failed:'), error.message);
      process.exit(1);
    }
  });

// P2: cleanup 命令
program
  .command('cleanup')
  .description('Clean up legacy SDD workflow files')
  .option('--dry-run', 'Preview without deleting', false)
  .option('--all', 'Clean all known legacy files', false)
  .action(async (options) => {
    const cwd = process.cwd();
    const detected = detectPlatform(cwd);
    const platforms = detected === 'both' ? ['claude', 'opencode'] : [detected];

    console.log(chalk.blue('\n🧹 Cleaning up legacy SDD files...\n'));

    const legacyCount = await cleanupLegacyCommands(cwd, platforms, options.dryRun);

    if (legacyCount === 0) {
      console.log(chalk.green('✓ No legacy files found. Clean!'));
    } else if (options.dryRun) {
      console.log(chalk.yellow(`\n⚠ Found ${legacyCount} legacy file(s). Run without --dry-run to remove.`));
    } else {
      console.log(chalk.green(`\n✓ Removed ${legacyCount} legacy file(s).`));
    }
    console.log();
  });

// P2: doctor 命令
program
  .command('doctor')
  .description('Diagnose SDD workflow health')
  .action(async () => {
    const cwd = process.cwd();
    let issues = 0;

    console.log(chalk.blue('\n🔍 SDD Workflow Health Check\n'));

    // Check openspec config
    const configPath = path.join(cwd, 'openspec', 'config.yaml');
    if (await fs.pathExists(configPath)) {
      console.log(chalk.green('✅ openspec/config.yaml exists'));
    } else {
      console.log(chalk.red('❌ openspec/config.yaml missing — run `sdd init`'));
      issues++;
    }

    // Check schema
    const schemaDir = path.join(cwd, 'openspec', 'schemas', 'trinity-workflow-v2');
    if (await fs.pathExists(schemaDir)) {
      const schemaFile = path.join(schemaDir, 'schema.yaml');
      if (await fs.pathExists(schemaFile)) {
        console.log(chalk.green('✅ trinity-workflow-v2 schema exists'));
      } else {
        console.log(chalk.red('❌ schema.yaml missing in trinity-workflow-v2'));
        issues++;
      }
    } else {
      console.log(chalk.red('❌ trinity-workflow-v2 schema directory missing'));
      issues++;
    }

    // Check skills per platform
    const detected = detectPlatform(cwd);
    const platforms = detected === 'both' ? ['claude', 'opencode'] : [detected];

    for (const plat of platforms) {
      const config = PLATFORMS[plat];
      const skillsDir = path.join(cwd, config.skillsDir);
      if (await fs.pathExists(skillsDir)) {
        const allDirs = await fs.readdir(skillsDir);
        const trinitySkills = [];
        for (const d of allDirs) {
          if (d.startsWith('trinity-')) {
            const stat = await fs.stat(path.join(skillsDir, d));
            if (stat.isDirectory()) trinitySkills.push(d);
          }
        }
        if (trinitySkills.length >= 7) {
          console.log(chalk.green(`✅ ${config.name}: ${trinitySkills.length} Trinity skills installed`));
        } else {
          console.log(chalk.yellow(`⚠️  ${config.name}: Only ${trinitySkills.length}/7 Trinity skills — run \`sdd init --force\``));
          issues++;
        }
      } else {
        console.log(chalk.yellow(`⚠️  ${config.name}: Skills directory missing — run \`sdd init\``));
        issues++;
      }
    }

    // Check legacy commands
    for (const plat of platforms) {
      const config = PLATFORMS[plat];
      const commandsDir = path.join(cwd, config.commandsDir);
      if (await fs.pathExists(commandsDir)) {
        const existing = await fs.readdir(commandsDir);
        const found = existing.filter(f => LEGACY_COMMANDS.includes(f));
        if (found.length > 0) {
          console.log(chalk.yellow(`⚠️  ${config.name}: ${found.length} legacy commands found — run \`sdd cleanup\``));
          issues++;
        } else {
          console.log(chalk.green(`✅ ${config.name}: No legacy commands`));
        }
      }
    }

    // Check openspec CLI
    try {
      const { execSync } = await import('child_process');
      const version = execSync('openspec --version', { encoding: 'utf8' }).trim();
      console.log(chalk.green(`✅ openspec CLI: ${version}`));
    } catch {
      console.log(chalk.yellow('⚠️  openspec CLI not found — install with `npm install -g openspec`'));
      issues++;
    }

    console.log();
    if (issues === 0) {
      console.log(chalk.green.bold('✅ All checks passed! SDD workflow is healthy.\n'));
    } else {
      console.log(chalk.yellow.bold(`⚠️  Found ${issues} issue(s). Fix them for optimal workflow.\n`));
    }
  });

program
  .command('list')
  .description('List available commands and schemas')
  .action(() => {
    console.log(chalk.bold('\n📚 Trinity Workflow v2 Commands:'));
    console.log('   /trinity:new "描述"   - 创建新变更（带追踪）');
    console.log('   /trinity:continue    - 继续下一个 artifact');
    console.log('   /trinity:apply       - 执行任务（3-Strike）');
    console.log('   /trinity:verify      - 验证实现（三维度）');
    console.log('   /trinity:archive     - 归档变更');
    console.log('   /trinity:ff "描述"   - 快速流程');

    console.log(chalk.bold('\n📦 Schema:'));
    console.log('   trinity-workflow-v2  - 三位一体架构工作流 v2');

    console.log(chalk.bold('\n🖥️ Supported Platforms:'));
    console.log('   claude   - Claude Code (.claude/skills/, .claude/commands/)');
    console.log('   opencode - OpenCode (.opencode/skills/, .opencode/commands/)');
    console.log('   both     - Install for both platforms (default)\n');
  });

program.parse();
