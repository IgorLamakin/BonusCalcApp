'use strict';

/**
 * IPC-слой: единственное место, где интерфейс общается с системой.
 * Все входящие данные заново валидируются — рендереру не доверяем.
 */

const path = require('path');
const fs = require('fs');
const { app, dialog, ipcMain, shell } = require('electron');
const Calc = require('../shared/calc');
const { createXlsxBuffer } = require('./exporters/excel');
const { createPdfBuffer } = require('./exporters/pdf');

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function safeFileName(name) {
  const cleaned = String(name || '')
    // eslint-disable-next-line no-control-regex -- вырезаем управляющие символы из имени файла
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'Расчёт';
}

function resolveSaveDir(settings) {
  const candidates = [settings.lastSaveDir, app.getPath('downloads')];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* каталог больше не существует — пробуем следующий */
    }
  }
  return app.getPath('documents');
}

function describeFsError(err) {
  if (!err) return 'Неизвестная ошибка';
  if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
    return 'Файл занят другой программой — закройте его и попробуйте снова';
  }
  if (err.code === 'ENOSPC') return 'На диске закончилось место';
  if (err.code === 'ENOENT') return 'Папка для сохранения недоступна';
  return err.message || String(err);
}

function registerIpcHandlers({ getWindow, stores, appInfo }) {
  const ownerWindow = () => {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  const showSaveDialog = async (options) => {
    const win = ownerWindow();
    return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
  };

  const showMessageBox = async (options) => {
    const win = ownerWindow();
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  };

  /**
   * Отклоняет вызовы, пришедшие не из окна приложения (например, если
   * когда-нибудь появится iframe или посторонний документ).
   */
  const guard = (handler) => async (event, payload) => {
    const url = event.senderFrame && event.senderFrame.url ? event.senderFrame.url : '';
    if (url && !url.startsWith('file://')) {
      throw new Error('Запрос отклонён: посторонний источник');
    }
    return handler(payload, event);
  };

  // --- Служебное ---
  ipcMain.handle(
    'app:info',
    guard(() => ({
      version: appInfo.version,
      electron: process.versions.electron,
      isPackaged: app.isPackaged,
      dataDir: app.getPath('userData')
    }))
  );

  ipcMain.handle(
    'app:open-data-folder',
    guard(async () => {
      const error = await shell.openPath(app.getPath('userData'));
      return error ? { ok: false, msg: error } : { ok: true, msg: 'Открыта папка с данными' };
    })
  );

  // --- Настройки ---
  ipcMain.handle(
    'settings:load',
    guard(() => {
      stores.settings.load();
      return { settings: stores.settings.get(), recovered: stores.settings.recovered };
    })
  );

  ipcMain.handle(
    'settings:save',
    guard((patch) => {
      const source = patch && typeof patch === 'object' ? patch : {};
      const settings = stores.settings.update((current) => ({ ...current, ...source }));
      return { settings };
    })
  );

  // --- История ---
  ipcMain.handle(
    'history:load',
    guard(() => stores.history.list())
  );

  ipcMain.handle(
    'history:add',
    guard((inputs) => stores.history.add(inputs))
  );

  ipcMain.handle(
    'history:remove',
    guard((id) => stores.history.remove(id))
  );

  ipcMain.handle(
    'history:clear',
    guard(async () => {
      const { items } = stores.history.list();
      if (items.length === 0) return { items: [], cancelled: false };

      const { response } = await showMessageBox({
        type: 'warning',
        buttons: ['Отмена', 'Очистить'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Очистить историю',
        message: 'Удалить все сохранённые расчёты?',
        detail: `Записей в истории: ${items.length}. Действие нельзя отменить.`
      });

      if (response !== 1) return { items, cancelled: true };
      return { ...stores.history.clear(), cancelled: false };
    })
  );

  ipcMain.handle(
    'history:export-csv',
    guard(async () => {
      const { items } = stores.history.list();
      if (items.length === 0) return { ok: false, msg: 'История пуста — нечего выгружать' };

      const settings = stores.settings.get();
      const { canceled, filePath } = await showSaveDialog({
        title: 'Выгрузить историю расчётов',
        defaultPath: path.join(resolveSaveDir(settings), `История расчётов_${dateStamp()}.csv`),
        filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      });
      if (canceled || !filePath) return { ok: false, cancelled: true, msg: 'Сохранение отменено' };

      try {
        fs.writeFileSync(filePath, stores.history.toCsv(), 'utf8');
        stores.settings.update((current) => ({
          ...current,
          lastSaveDir: path.dirname(filePath)
        }));
        return { ok: true, msg: `История выгружена: ${path.basename(filePath)}`, path: filePath };
      } catch (err) {
        return { ok: false, msg: describeFsError(err) };
      }
    })
  );

  // --- Экспорт отчётов ---
  const exportReport = async (kind, payload) => {
    const inputs = Calc.normalizeInputs(payload);
    const model = Calc.buildReportModel({ inputs });
    const isPdf = kind === 'pdf';
    const extension = isPdf ? 'pdf' : 'xlsx';
    const settings = stores.settings.get();
    const fileName = `${safeFileName(model.entity)}_отчёт_${dateStamp()}.${extension}`;

    const { canceled, filePath } = await showSaveDialog({
      title: isPdf ? 'Сохранить отчёт в PDF' : 'Сохранить отчёт в Excel',
      defaultPath: path.join(resolveSaveDir(settings), fileName),
      filters: [
        isPdf ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Excel', extensions: ['xlsx'] }
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (canceled || !filePath) return { ok: false, cancelled: true, msg: 'Сохранение отменено' };

    try {
      let buffer;
      if (isPdf) {
        buffer = await createPdfBuffer(model, {
          fontPath: path.join(app.getAppPath(), 'font.ttf'),
          appName: appInfo.name,
          version: appInfo.version
        });
      } else {
        buffer = await createXlsxBuffer(model, {
          appName: appInfo.name,
          version: appInfo.version
        });
      }
      fs.writeFileSync(filePath, buffer);
      stores.settings.update((current) => ({
        ...current,
        lastSaveDir: path.dirname(filePath)
      }));
      return {
        ok: true,
        msg: `${isPdf ? 'PDF' : 'Excel'} сохранён: ${path.basename(filePath)}`,
        path: filePath
      };
    } catch (err) {
      if (err && err.code === 'FONT_MISSING') {
        return { ok: false, msg: 'Не найден шрифт отчёта font.ttf — переустановите приложение' };
      }
      console.error('[export]', err);
      return { ok: false, msg: describeFsError(err) };
    }
  };

  ipcMain.handle(
    'export:excel',
    guard((payload) => exportReport('xlsx', payload))
  );

  ipcMain.handle(
    'export:pdf',
    guard((payload) => exportReport('pdf', payload))
  );
}

module.exports = { registerIpcHandlers, safeFileName, dateStamp, resolveSaveDir };
