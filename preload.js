'use strict';

/**
 * Безопасный мост между интерфейсом и главным процессом.
 * Рендерер не получает доступ к Node.js — только перечисленные вызовы.
 */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  // Служебное
  appInfo: () => invoke('app:info'),
  openDataFolder: () => invoke('app:open-data-folder'),

  // Настройки (ставки налогов, процент премии, последняя папка)
  settingsLoad: () => invoke('settings:load'),
  settingsSave: (patch) => invoke('settings:save', patch),

  // История расчётов
  historyLoad: () => invoke('history:load'),
  historyAdd: (inputs) => invoke('history:add', inputs),
  historyRemove: (id) => invoke('history:remove', id),
  historyClear: () => invoke('history:clear'),
  historyExportCsv: () => invoke('history:export-csv'),

  // Экспорт отчётов (возвращают { ok, msg, path })
  exportExcel: (inputs) => invoke('export:excel', inputs),
  exportPdf: (inputs) => invoke('export:pdf', inputs)
});
