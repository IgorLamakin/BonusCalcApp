const { contextBridge, ipcRenderer } = require('electron');

// Безопасный мост между интерфейсом (рендерером) и main-процессом.
// Рендерер НЕ получает доступ к Node API напрямую (contextIsolation:true).
// Здесь перечислены ТОЛЬКО те каналы, которые нужны интерфейсу.
contextBridge.exposeInMainWorld('api', {
  // История расчётов
  historyLoad: () => ipcRenderer.invoke('history:load'),
  historyAdd: (entry) => ipcRenderer.invoke('history:add', entry),
  historyRemove: (id) => ipcRenderer.invoke('history:remove', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),

  // Экспорт файлов (возвращают {ok, msg})
  exportExcel: (data) => ipcRenderer.invoke('save-excel', data),
  exportPdf: (data) => ipcRenderer.invoke('save-pdf', data),

  // Настройки (ставки налогов)
  settingsLoad: () => ipcRenderer.invoke('settings:load'),
  settingsSave: (settings) => ipcRenderer.invoke('settings:save', settings)
});
