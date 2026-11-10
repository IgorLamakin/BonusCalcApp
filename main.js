'use strict';

/**
 * Точка входа приложения.
 *
 * Вся логика разложена по модулям:
 *   src/main/appData.js   — настройки и история (файлы, миграции)
 *   src/main/window.js    — создание окна и политики безопасности
 *   src/main/ipc.js       — каналы связи с интерфейсом и экспорт отчётов
 *   src/shared/calc.js    — формулы, валидация, модель отчёта (общая с тестами)
 */

const { app, BrowserWindow, Menu, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStores } = require('./src/main/appData');
const { registerIpcHandlers } = require('./src/main/ipc');
const { createMainWindow, buildApplicationMenu } = require('./src/main/window');
const { createUpdater } = require('./src/main/updater');

const APP_ID = 'com.bonuscalc.app';
const APP_NAME = 'Калькулятор премии';
const SMOKE = process.argv.includes('--smoke');

// Проверка не должна трогать настоящие настройки и историю пользователя.
if (SMOKE) {
  const smokeDir = path.join(os.tmpdir(), 'bonuscalc-smoke', String(process.pid));
  fs.mkdirSync(smokeDir, { recursive: true });
  app.setPath('userData', smokeDir);
}

let mainWindow = null;
let stores = null;

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * В версии 2.0 папка данных называлась по старому имени пакета
 * (raschet-rentabelnosti). Чтобы настройки и история не «потерялись»
 * после переименования, один раз копируем их в новую папку.
 */
function migrateLegacyData() {
  const currentDir = app.getPath('userData');
  const legacyDir = path.join(path.dirname(currentDir), 'raschet-rentabelnosti');
  if (path.resolve(currentDir) === path.resolve(legacyDir)) return;
  if (!fs.existsSync(legacyDir)) return;

  for (const name of ['settings.json', 'history.json']) {
    const source = path.join(legacyDir, name);
    const target = path.join(currentDir, name);
    if (!fs.existsSync(source) || fs.existsSync(target)) continue;
    try {
      fs.mkdirSync(currentDir, { recursive: true });
      fs.copyFileSync(source, target);
      console.log(`[migration] скопирован ${name} из старой папки данных`);
    } catch (err) {
      console.error(`[migration] не удалось скопировать ${name}:`, err.message);
    }
  }
}

async function bootstrap() {
  migrateLegacyData();
  stores = createStores(app.getPath('userData'));
  Menu.setApplicationMenu(buildApplicationMenu(!app.isPackaged));

  // Автообновление поднимаем до создания окна, чтобы интерфейс сразу мог
  // узнать его состояние (и не получить «нет обработчика»).
  const updater = createUpdater({ getWindow: () => mainWindow });

  mainWindow = createMainWindow({
    stores,
    isDev: !app.isPackaged,
    showWindow: !SMOKE
  });

  registerIpcHandlers({
    getWindow: () => mainWindow,
    stores,
    appInfo: { name: APP_NAME, version: app.getVersion() }
  });

  if (SMOKE) {
    const { runSmokeTest } = require('./src/main/smoke');
    const passed = await runSmokeTest(mainWindow);
    app.exit(passed ? 0 : 1);
  } else {
    updater.scheduleStartupCheck();
  }
}

app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  // Второй экземпляр не нужен: оба писали бы в одни и те же файлы.
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);

  app
    .whenReady()
    .then(bootstrap)
    .catch((err) => {
      console.error('[startup]', err);
      dialog.showErrorBox('Не удалось запустить приложение', String((err && err.message) || err));
      app.exit(1);
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootstrap().catch((err) => console.error('[activate]', err));
    } else {
      focusMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // В приложении нет веб-вью, а окна открываются только через shell.openExternal.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('render-process-gone', (_e, details) => {
      console.error('[renderer] process gone:', details.reason);
    });
  });

  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
}
