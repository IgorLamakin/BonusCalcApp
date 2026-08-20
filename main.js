const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const iconPath = path.join(__dirname, 'assets', 'icon.png');
const historyFile = () => path.join(app.getPath('userData'), 'history.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
  vatPercent: 20,
  incomeTaxPercent: 20,
  saveDir: '' // пустая строка = Downloads
};

function loadSettings() {
  try {
    if (!fs.existsSync(settingsFile())) return { ...DEFAULT_SETTINGS };
    const data = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return { ...DEFAULT_SETTINGS, ...data };
  } catch (e) {
    console.error('loadSettings error:', e);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  try {
    const merged = { ...DEFAULT_SETTINGS, ...s };
    fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (e) {
    console.error('saveSettings error:', e);
    return { ...DEFAULT_SETTINGS };
  }
}

function loadHistory() {
  try {
    if (!fs.existsSync(historyFile())) return [];
    const data = JSON.parse(fs.readFileSync(historyFile(), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('loadHistory error:', e);
    return [];
  }
}

function saveHistory(list) {
  try {
    fs.writeFileSync(historyFile(), JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('saveHistory error:', e);
  }
}

// Валидация числа: безопасная конвертация, обрезка до разумного диапазона
function toNum(v, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  if (n < 0) return 0;
  if (n > 1e12) return 1e12;
  return Math.round(n * 100) / 100;
}

// Валидация входящих данных расчёта (защита IPC от мусора/инъекций)
function sanitizeCalc(data) {
  if (!data || typeof data !== 'object') return null;
  const base = {
    bonusPercent: toNum(data.bonusPercent, 0),
    vat: toNum(data.vat),
    incomeTax: toNum(data.incomeTax),
    netProfit: toNum(data.netProfit),
    bonus: toNum(data.bonus),
    vatPercent: toNum(data.vatPercent, 20),
    incomeTaxPercent: toNum(data.incomeTaxPercent, 20)
  };
  const type = data.type === 'margin' ? 'margin' : 'standard';
  if (type === 'margin') {
    return {
      ...base,
      type,
      managerName: String(data.managerName || 'Без названия').replace(/[\u0000-\u001f<>]/g, '').slice(0, 120) || 'Без названия',
      margin: toNum(data.margin)
    };
  }
  return {
    ...base,
    type,
    companyName: String(data.companyName || 'Без названия').replace(/[\u0000-\u001f<>]/g, '').slice(0, 120) || 'Без названия',
    revenue: toNum(data.revenue),
    purchase: toNum(data.purchase),
    logistics: toNum(data.logistics),
    margin: toNum(data.margin)
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 460,
    height: 820,
    minWidth: 400,
    minHeight: 640,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: 'persist:bonuscalc',
      webSecurity: true
    },
    title: "Калькулятор премии Pro",
    show: false
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile('index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) {
      event.preventDefault();
    }
  });

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- История расчётов ---
ipcMain.handle('history:load', () => loadHistory());

ipcMain.handle('history:add', (event, entry) => {
  const clean = sanitizeCalc(entry);
  if (!clean) return loadHistory();
  const list = loadHistory();
  const idx = clean.type === 'margin'
    ? list.findIndex(e =>
      e.type === 'margin' &&
      e.managerName === clean.managerName &&
      e.margin === clean.margin &&
      e.bonusPercent === clean.bonusPercent
    )
    : list.findIndex(e =>
      e.type !== 'margin' &&
      e.companyName === clean.companyName &&
      e.revenue === clean.revenue &&
      e.purchase === clean.purchase &&
      e.logistics === clean.logistics &&
      e.bonusPercent === clean.bonusPercent
    );
  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ...clean,
    createdAt: new Date().toISOString()
  };
  if (idx >= 0) {
    record.id = list[idx].id;
    list[idx] = record;
  } else {
    list.unshift(record);
  }
  const trimmed = list.slice(0, 100);
  saveHistory(trimmed);
  return trimmed;
});

ipcMain.handle('history:remove', (event, id) => {
  const s = String(id).slice(0, 40);
  const list = loadHistory().filter(e => e.id !== s);
  saveHistory(list);
  return list;
});

ipcMain.handle('history:clear', () => {
  saveHistory([]);
  return [];
});

// --- Настройки (ставки налогов) ---
ipcMain.handle('settings:load', () => loadSettings());

ipcMain.handle('settings:save', (event, settings) => {
  const validated = {
    vatPercent: toNum(settings.vatPercent, 20),
    incomeTaxPercent: toNum(settings.incomeTaxPercent, 20)
  };
  return saveSettings(validated);
});

// --- Экспорт Excel ---
ipcMain.handle('save-excel', async (event, data) => {
  const c = sanitizeCalc(data);
  if (!c) return { ok: false, msg: 'Нет данных для экспорта' };

  const safeName = (c.companyName || c.managerName || 'Расчет').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Расчет';
  const fileName = safeName + "_Report.xlsx";

  const { filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath('downloads'), fileName),
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
  });

  if (!filePath) return { ok: false, msg: 'Отменено' };

  try {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Отчет');

    ws.mergeCells('A1:B1');
    ws.getCell('A1').value = 'ОТЧЕТ ПО РАСЧЕТУ РЕНТАБЕЛЬНОСТИ';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    ws.getCell('A3').value = 'ИСХОДНЫЕ ДАННЫЕ';
    ws.getCell('A3').font = { bold: true };

    if (c.type === 'margin') {
      ws.addRow(['Менеджер', c.managerName]);
      ws.addRow(['Маржа', c.margin]);
    } else {
      ws.addRow(['Компания', c.companyName]);
      ws.addRow(['Выручка (с НДС)', c.revenue]);
      ws.addRow(['Закупка (с НДС)', c.purchase]);
      ws.addRow(['Логистика (с НДС)', c.logistics]);
    }
    ws.addRow(['Ставка НДС', c.vatPercent + '%']);
    ws.addRow(['Налог на прибыль', c.incomeTaxPercent + '%']);
    ws.addRow(['Процент премии', c.bonusPercent + '%']);
    ws.addRow([]);

    ws.getCell(c.type === 'margin' ? 'A9' : 'A10').value = 'РЕЗУЛЬТАТЫ РАСЧЕТА';
    ws.getCell(c.type === 'margin' ? 'A9' : 'A10').font = { bold: true };
    ws.addRow(['Маржа', c.margin]);
    ws.addRow(['НДС к уплате', c.vat]);
    ws.addRow(['Налог на прибыль', c.incomeTax]);
    ws.addRow(['Чистая прибыль', c.netProfit]);
    ws.addRow(['ИТОГОВАЯ ПРЕМИЯ', c.bonus]);

    const lastRow = c.type === 'margin' ? 14 : 15;
    ws.getRow(lastRow).font = { bold: true, size: 12 };

    ws.columns.forEach(column => {
      let maxColumnLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxColumnLength) maxColumnLength = columnLength;
      });
      column.width = maxColumnLength < 12 ? 12 : maxColumnLength + 2;
    });

    await workbook.xlsx.writeFile(filePath);
    return { ok: true, msg: 'Excel сохранён!' };
  } catch (err) {
    console.error(err);
    return { ok: false, msg: 'Ошибка при сохранении Excel' };
  }
});

// --- Экспорт PDF ---
ipcMain.handle('save-pdf', async (event, data) => {
  const c = sanitizeCalc(data);
  if (!c) return { ok: false, msg: 'Нет данных для экспорта' };

  const safeName = (c.companyName || c.managerName || 'Расчет').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Расчет';
  const fileName = safeName + "_Report.pdf";

  const { filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath('downloads'), fileName),
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });

  if (!filePath) return { ok: false, msg: 'Отменено' };

  return new Promise((resolve) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const fontPath = path.join(__dirname, 'font.ttf');
      if (fs.existsSync(fontPath)) {
        doc.registerFont('CustomFont', fontPath);
        doc.font('CustomFont');
      }

      doc.fontSize(20).text('ОТЧЕТ ПО РАСЧЕТУ ПРЕМИИ', { align: 'center' });
      doc.moveDown();

      if (c.type === 'margin') {
        doc.fontSize(12).text('Менеджер: ' + c.managerName, { align: 'left' });
      } else {
        doc.fontSize(12).text('Компания: ' + c.companyName, { align: 'left' });
      }
      doc.text('Дата: ' + new Date().toLocaleDateString('ru-RU'));
      doc.moveDown();

      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      doc.fontSize(14).text('Вводные данные:', { underline: true });
      if (c.type === 'margin') {
        doc.fontSize(12).text('Маржа: ' + c.margin.toLocaleString('ru-RU') + ' руб.');
      } else {
        doc.fontSize(12).text('Выручка: ' + c.revenue.toLocaleString('ru-RU') + ' руб.');
        doc.text('Закупка: ' + c.purchase.toLocaleString('ru-RU') + ' руб.');
        doc.text('Логистика: ' + c.logistics.toLocaleString('ru-RU') + ' руб.');
      }
      doc.text('Ставка НДС: ' + c.vatPercent + '%');
      doc.text('Налог на прибыль: ' + c.incomeTaxPercent + '%');
      doc.text('Ставка премии: ' + c.bonusPercent + '%');
      doc.moveDown();

      doc.fontSize(14).text('Результаты расчета:', { underline: true });
      doc.fontSize(12).text('Маржа: ' + c.margin.toLocaleString('ru-RU') + ' руб.');
      doc.text('НДС: ' + c.vat.toLocaleString('ru-RU') + ' руб.');
      doc.text('Налог на прибыль: ' + c.incomeTax.toLocaleString('ru-RU') + ' руб.');
      doc.text('Чистая прибыль: ' + c.netProfit.toLocaleString('ru-RU') + ' руб.');
      doc.moveDown();

      doc.fontSize(16).fillColor('#1f9d61').text('ИТОГОВАЯ ПРЕМИЯ: ' + c.bonus.toLocaleString('ru-RU') + ' руб.');

      doc.end();
      stream.on('finish', () => resolve({ ok: true, msg: 'PDF сохранён!' }));
      stream.on('error', (err) => {
        console.error(err);
        resolve({ ok: false, msg: 'Ошибка при сохранении PDF' });
      });
    } catch (err) {
      console.error(err);
      resolve({ ok: false, msg: 'Ошибка при сохранении PDF' });
    }
  });
});
