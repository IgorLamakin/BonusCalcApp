'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell } = require('electron');

function buildApplicationMenu(isDev) {
  if (!isDev) return null;
  return Menu.buildFromTemplate([
    {
      label: 'Файл',
      submenu: [{ role: 'quit', label: 'Выход' }]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Перезагрузить' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Масштаб по умолчанию' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' }
      ]
    }
  ]);
}

function sanitizeBounds(saved) {
  const fallback = { width: 480, height: 860, x: null, y: null };
  const source = saved && typeof saved === 'object' ? saved : {};
  const width = Number.isFinite(Number(source.width))
    ? Math.max(420, Math.min(4000, Math.round(Number(source.width))))
    : fallback.width;
  const height = Number.isFinite(Number(source.height))
    ? Math.max(640, Math.min(3000, Math.round(Number(source.height))))
    : fallback.height;
  const x = Number.isFinite(Number(source.x)) ? Math.round(Number(source.x)) : null;
  const y = Number.isFinite(Number(source.y)) ? Math.round(Number(source.y)) : null;
  return { width, height, x, y, maximized: Boolean(source.maximized) };
}

/**
 * Создаёт главное окно приложения.
 * @param {{stores: any, isDev: boolean, showWindow?: boolean}} params
 */
function createMainWindow({ stores, isDev, showWindow = true }) {
  const settings = stores.settings.get();
  const bounds = sanitizeBounds(settings.window);
  const appPath = app.getAppPath();

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x === null || bounds.y === null ? {} : { x: bounds.x, y: bounds.y }),
    minWidth: 420,
    minHeight: 640,
    show: false,
    title: 'Калькулятор премии',
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    icon: path.join(appPath, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(appPath, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      spellcheck: false,
      devTools: isDev,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  if (bounds.maximized) win.maximize();

  if (showWindow) {
    win.once('ready-to-show', () => win.show());
  }

  win.loadFile(path.join(appPath, 'index.html'));

  win.once('close', () => {
    if (win.isDestroyed()) return;
    const normal = win.getNormalBounds();
    stores.settings.update((current) => ({
      ...current,
      window: { ...normal, maximized: win.isMaximized() }
    }));
  });

  // Внешние ссылки — только в системном браузере, окна не открываем.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // Уходим со страницы только если это наш собственный файл.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  // Никаких разрешений (камера, микрофон, гео) приложению не нужно.
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });

  return win;
}

module.exports = { createMainWindow, buildApplicationMenu, sanitizeBounds };
