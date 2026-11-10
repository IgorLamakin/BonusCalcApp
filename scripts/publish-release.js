'use strict';

/**
 * Публикация релиза на GitHub.
 *
 *   npm run release              # выложить текущую версию из package.json
 *   npm run release -- --dry-run # только показать, что будет загружено
 *
 * Требует собранных файлов в dist/ (npm run dist + npm run dist-portable)
 * и авторизованного GitHub CLI (gh auth login).
 *
 * Скрипт создаёт (или дополняет) релиз v<version> и загружает:
 *   - установщик *.exe и его .blockmap  — то, что скачивает автообновление;
 *   - latest.yml                        — манифест автообновления;
 *   - портативную версию (если собрана).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const VERSION = pkg.version;
const TAG = `v${VERSION}`;
const REPO = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};
const REPO_SLUG = `${REPO.owner}/${REPO.repo}`;
const dryRun = process.argv.includes('--dry-run');
const notesFile = path.join(ROOT, 'RELEASE_NOTES.md');

function fail(message) {
  console.error(`\n[release] ${message}`);
  process.exit(1);
}

function gh(args, options = {}) {
  const result = spawnSync('gh', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit'
  });
  if (result.error) fail(`не удалось запустить gh: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFail) {
    fail(`команда «gh ${args.join(' ')}» завершилась с кодом ${result.status}`);
  }
  return result;
}

function requireFile(name) {
  const full = path.join(DIST, name);
  if (!fs.existsSync(full)) fail(`не найден ${full} — сначала выполните сборку`);
  return full;
}

function main() {
  if (!['github'].includes(REPO.provider)) fail('в package.json не настроен build.publish');
  if (!fs.existsSync(DIST)) fail('папка dist/ не найдена — сначала соберите приложение');

  const artifacts = [
    requireFile(`BonusCalc-Setup-${VERSION}-x64.exe`),
    requireFile(`BonusCalc-Setup-${VERSION}-x64.exe.blockmap`),
    requireFile('latest.yml')
  ];

  const portable = `BonusCalc-Portable-${VERSION}-x64.exe`;
  if (fs.existsSync(path.join(DIST, portable))) artifacts.push(path.join(DIST, portable));
  else console.warn(`[release] портативная версия ${portable} не собрана — пропускаю`);

  console.log(`[release] версия ${VERSION}, тег ${TAG}, репозиторий ${REPO_SLUG}`);
  console.log('[release] файлы:');
  for (const file of artifacts) {
    console.log(`  - ${path.basename(file)} (${(fs.statSync(file).size / 1048576).toFixed(1)} МБ)`);
  }

  if (dryRun) {
    console.log('[release] пробный запуск: ничего не загружено');
    return;
  }

  const exists =
    gh(['release', 'view', TAG, '--repo', REPO_SLUG], {
      capture: true,
      allowFail: true
    }).status === 0;

  if (exists) {
    console.log(`[release] релиз ${TAG} уже есть — догружаю файлы (замена при совпадении)`);
    gh(['release', 'upload', TAG, ...artifacts, '--repo', REPO_SLUG, '--clobber']);
  } else {
    const args = [
      'release',
      'create',
      TAG,
      ...artifacts,
      '--repo',
      REPO_SLUG,
      '--title',
      `${TAG} — ${pkg.build.productName}`
    ];
    if (fs.existsSync(notesFile)) args.push('--notes-file', notesFile);
    else args.push('--generate-notes');
    gh(args);
  }

  const view = gh(['release', 'view', TAG, '--repo', REPO_SLUG, '--json', 'url,assets'], {
    capture: true
  });
  const info = JSON.parse(view.stdout || '{}');
  console.log(`\n[release] готово: ${info.url || TAG}`);
  for (const asset of info.assets || []) {
    console.log(`  - ${asset.name} (${(Number(asset.size) / 1048576).toFixed(1)} МБ)`);
  }
}

main();
