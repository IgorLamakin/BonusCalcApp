'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ExcelJS = require('exceljs');
const Calc = require('../src/shared/calc');
const { createWorkbook, createXlsxBuffer } = require('../src/main/exporters/excel');
const { createPdfBuffer } = require('../src/main/exporters/pdf');

const INPUTS = {
  type: 'deal',
  companyName: 'ООО «Альфа»',
  revenue: 1200000,
  purchase: 600000,
  logistics: 0,
  bonusPercent: 30,
  vatPercent: 20,
  incomeTaxPercent: 20
};

function sampleModel() {
  return Calc.buildReportModel({ inputs: INPUTS, createdAt: '2026-11-10T10:00:00.000Z' });
}

function collectRows(worksheet) {
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, number) => {
    rows.push({
      number,
      values: [row.getCell(1).value, row.getCell(2).value],
      bold: Boolean(row.getCell(1).font && row.getCell(1).font.bold),
      numFmt: row.getCell(2).numFmt || null
    });
  });
  return rows;
}

test('Excel: отчёт содержит исходные данные и подпись «Процент премии»', () => {
  const workbook = createWorkbook(sampleModel(), { appName: 'Тест', version: '1.0.0' });
  const rows = collectRows(workbook.getWorksheet('Отчёт'));
  const labels = rows.map((row) => row.values[0]);

  assert.ok(labels.includes('ИСХОДНЫЕ ДАННЫЕ'), 'есть заголовок исходных данных');
  assert.ok(labels.includes('РЕЗУЛЬТАТЫ РАСЧЁТА'), 'есть заголовок результатов');
  assert.ok(labels.includes('Процент премии'), 'ставка премии не затёрта заголовком');
  assert.ok(labels.includes('Компания'), 'есть компания');

  const percentRow = rows.find((row) => row.values[0] === 'Процент премии');
  assert.equal(percentRow.values[1], 30);
  assert.equal(percentRow.numFmt, '0.##"%"');
});

test('Excel: жирным и рамкой выделена именно итоговая строка', () => {
  const workbook = createWorkbook(sampleModel());
  const rows = collectRows(workbook.getWorksheet('Отчёт'));
  const total = rows.find((row) => row.values[0] === 'Итоговая премия');
  assert.ok(total, 'есть итоговая строка');
  assert.equal(total.values[1], 115200);
  assert.equal(total.bold, true);
  assert.ok(total.numFmt && total.numFmt.indexOf('#,##0.00') === 0);

  const notBold = rows.find((row) => row.values[0] === 'Чистая прибыль');
  assert.equal(notBold.bold, false);
});

test('Excel: файл читается обратно и содержит верные суммы', async () => {
  const buffer = await createXlsxBuffer(sampleModel(), { appName: 'Тест', version: '1.0.0' });
  assert.ok(buffer.length > 5000);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Отчёт');
  const cells = new Map();
  sheet.eachRow({ includeEmpty: false }, (row) => {
    cells.set(String(row.getCell(1).value), row.getCell(2).value);
  });

  assert.equal(cells.get('Выручка (с НДС)'), 1200000);
  assert.equal(cells.get('Маржа'), 600000);
  assert.equal(cells.get('НДС к уплате'), 120000);
  assert.equal(cells.get('Налог на прибыль'), 96000);
  assert.equal(cells.get('Чистая прибыль'), 384000);
  assert.equal(cells.get('Итоговая премия'), 115200);
});

test('PDF: файл собирается и начинается с %PDF', async () => {
  const buffer = await createPdfBuffer(sampleModel(), {
    fontPath: path.join(__dirname, '..', 'font.ttf'),
    appName: 'Тест',
    version: '1.0.0'
  });
  assert.ok(buffer.length > 5000, `PDF слишком маленький: ${buffer.length}`);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

test('PDF: отчёт по марже тоже собирается', async () => {
  const model = Calc.buildReportModel({
    inputs: {
      type: 'margin',
      managerName: 'Иванов И.И.',
      margin: 100000,
      bonusPercent: 30,
      vatPercent: 20,
      incomeTaxPercent: 20
    }
  });
  const buffer = await createPdfBuffer(model, {
    fontPath: path.join(__dirname, '..', 'font.ttf'),
    appName: 'Тест'
  });
  assert.ok(buffer.length > 5000);
});

test('PDF: без шрифта возвращается понятная ошибка FONT_MISSING', async () => {
  const missing = path.join(os.tmpdir(), 'no-such-font-' + Date.now() + '.ttf');
  await assert.rejects(
    createPdfBuffer(sampleModel(), { fontPath: missing }),
    (err) => err.code === 'FONT_MISSING'
  );
});

test('экспорт не создаёт файлов на диске сам по себе', () => {
  const before = fs.readdirSync(os.tmpdir()).length;
  createWorkbook(sampleModel());
  const after = fs.readdirSync(os.tmpdir()).length;
  assert.equal(after, before);
});
