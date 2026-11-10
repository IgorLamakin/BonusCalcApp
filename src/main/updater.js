'use strict';

/**
 * Автообновление через electron-updater.
 *
 * Работает только в установленной версии (NSIS). В портативной сборке и в
 * режиме разработки проверка отключена: там обновление делается вручную.
 * Обновления скачиваются только по нажатию пользователя, установка — тоже.
 */

const { app, ipcMain, shell } = require('electron');
const { describeUpdateStatus, RELEASES_URL } = require('./updateMessages');

const CHECK_DELAY_MS = 4000;

function createUpdater({ getWindow }) {
  let autoUpdater = null;
  let enabled = false;
  let disabledReason = null;
  let state = { status: 'idle' };
  let scheduled = false;

  const view = (payload) => ({ ...payload, view: describeUpdateStatus(payload) });

  const publish = (payload) => {
    state = payload;
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('update:status', view(payload));
  };

  function init() {
    if (!app.isPackaged) {
      disabledReason = 'dev';
      return;
    }
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      disabledReason = 'portable';
      return;
    }

    try {
      autoUpdater = require('electron-updater').autoUpdater;
    } catch (err) {
      console.error('[updater] не удалось загрузить electron-updater:', err.message);
      disabledReason = 'unavailable';
      return;
    }

    enabled = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (message) => console.log('[updater]', message),
      warn: (message) => console.warn('[updater]', message),
      error: (message) => console.error('[updater]', message),
      debug: () => {}
    };

    autoUpdater.on('checking-for-update', () => publish({ status: 'checking' }));
    autoUpdater.on('update-available', (info) =>
      publish({ status: 'available', version: info.version })
    );
    autoUpdater.on('update-not-available', () => publish({ status: 'current' }));
    autoUpdater.on('download-progress', (progress) =>
      publish({
        status: 'downloading',
        version: state.version,
        percent: Math.round(progress.percent)
      })
    );
    autoUpdater.on('update-downloaded', (info) =>
      publish({ status: 'ready', version: info.version })
    );
    autoUpdater.on('error', (err) => {
      console.error('[updater]', err && err.message ? err.message : err);
      publish({ status: 'error', version: state.version });
    });
  }

  async function check({ manual = false } = {}) {
    if (!enabled) {
      const payload = { status: 'disabled', reason: disabledReason };
      if (manual && disabledReason === 'portable') {
        shell.openExternal(RELEASES_URL).catch(() => {});
      }
      return view(payload);
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      console.error('[updater] проверка не удалась:', err && err.message ? err.message : err);
      publish({ status: 'error' });
    }
    return view(state);
  }

  function scheduleStartupCheck() {
    if (scheduled || !enabled) return;
    scheduled = true;
    setTimeout(() => {
      check().catch((err) => console.error('[updater]', err));
    }, CHECK_DELAY_MS);
  }

  async function download() {
    if (!enabled || !autoUpdater || state.status !== 'available') return view(state);
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      console.error('[updater] загрузка не удалась:', err && err.message ? err.message : err);
      publish({ status: 'error', version: state.version });
    }
    return view(state);
  }

  function install() {
    if (!enabled || !autoUpdater || state.status !== 'ready') return view(state);
    // Даём ответу дойти до интерфейса, затем перезапускаемся с новой версией.
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        console.error('[updater] установка не удалась:', err && err.message ? err.message : err);
      }
    });
    return view(state);
  }

  function registerIpc() {
    const guard = (handler) => async (event, payload) => {
      const url = event.senderFrame && event.senderFrame.url ? event.senderFrame.url : '';
      if (url && !url.startsWith('file://')) {
        throw new Error('Запрос отклонён: посторонний источник');
      }
      return handler(payload);
    };

    ipcMain.handle(
      'update:state',
      guard(() => {
        const payload = enabled ? state : { status: 'disabled', reason: disabledReason };
        return view(payload);
      })
    );
    ipcMain.handle(
      'update:check',
      guard((options) => check({ manual: Boolean(options && options.manual) }))
    );
    ipcMain.handle(
      'update:download',
      guard(() => download())
    );
    ipcMain.handle(
      'update:install',
      guard(() => install())
    );
  }

  init();
  registerIpc();

  return {
    isEnabled: () => enabled,
    disabledReason: () => disabledReason,
    scheduleStartupCheck,
    check,
    download,
    install
  };
}

module.exports = { createUpdater };
