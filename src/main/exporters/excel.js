'use strict';

/** Формирование Excel-отчёта из модели отчёта (см. Calc.buildReportModel). */

const ExcelJS = require('exceljs');

const MONEY_FMT = '#,##0.00';
const PERCENT_FMT = '0.##"%"';
const ACCENT = 'FF1F4ED8';
const MUTED = 'FF475569';
const TOTAL_FILL = 'FFFEF3C7';
const SECTION_FILL = 'FFF1F5F9';
const BORDER = 'FFE2E8F0';

function addSection(ws, title) {
  const row = ws.addRow([title]);
  row.height = 22;
  ws.mergeCells(row.number, 1, row.number, 2);
  const cell = row.getCell(1);
  cell.value = title;
  cell.font = { bold: true, size: 10, color: { argb: MUTED } };
  cell.alignment = { horizontal: 'left', vertical: 'middle' };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
  return row;
}

function addDataRow(ws, item) {
  const row = ws.addRow([item.label, item.value]);
  const labelCell = row.getCell(1);
  const valueCell = row.getCell(2);
  labelCell.font = { size: 11 };
  labelCell.alignment = { vertical: 'middle' };
  valueCell.font = { size: 11 };
  valueCell.alignment = { horizontal: 'right', vertical: 'middle' };
  if (item.unit === 'money') valueCell.numFmt = MONEY_FMT;
  else if (item.unit === 'percent') valueCell.numFmt = PERCENT_FMT;
  return row;
}

/**
 * @param {ReturnType<import('../../shared/calc').buildReportModel>} model
 * @param {{appName?: string, version?: string}} [meta]
 * @returns {ExcelJS.Workbook}
 */
function createWorkbook(model, meta = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.appName || 'Калькулятор премии';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Отчёт', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.6, right: 0.6, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }
    }
  });

  ws.columns = [{ width: 34 }, { width: 24 }];

  const titleRow = ws.addRow([model.title]);
  titleRow.height = 34;
  ws.mergeCells(titleRow.number, 1, titleRow.number, 2);
  const titleCell = titleRow.getCell(1);
  titleCell.font = { bold: true, size: 15, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } };

  const metaRow = ws.addRow([model.entityLabel, model.entity]);
  metaRow.getCell(1).font = { bold: true, size: 11 };
  metaRow.getCell(2).font = { size: 11 };
  metaRow.getCell(2).alignment = { horizontal: 'right' };

  const dateRow = ws.addRow(['Дата расчёта', model.dateText]);
  dateRow.getCell(1).font = { bold: true, size: 11 };
  dateRow.getCell(2).alignment = { horizontal: 'right' };

  ws.addRow([]);
  addSection(ws, 'ИСХОДНЫЕ ДАННЫЕ');
  for (const item of model.inputRows) addDataRow(ws, item);

  ws.addRow([]);
  addSection(ws, 'РЕЗУЛЬТАТЫ РАСЧЁТА');
  for (const item of model.resultRows) addDataRow(ws, item);

  ws.addRow([]);
  const totalRow = ws.addRow([model.total.label, model.total.value]);
  totalRow.height = 26;
  for (const cell of [totalRow.getCell(1), totalRow.getCell(2)]) {
    cell.font = { bold: true, size: 13, color: { argb: 'FF92400E' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER } },
      bottom: { style: 'double', color: { argb: 'FFD97706' } },
      left: { style: 'thin', color: { argb: BORDER } },
      right: { style: 'thin', color: { argb: BORDER } }
    };
  }
  totalRow.getCell(2).numFmt = MONEY_FMT;
  totalRow.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };

  ws.addRow([]);
  const footer = ws.addRow([
    `Сформировано в приложении «${meta.appName || 'Калькулятор премии'}»${meta.version ? ' v' + meta.version : ''}`
  ]);
  ws.mergeCells(footer.number, 1, footer.number, 2);
  footer.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF94A3B8' } };

  return workbook;
}

async function createXlsxBuffer(model, meta) {
  const workbook = createWorkbook(model, meta);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { createWorkbook, createXlsxBuffer, MONEY_FMT, PERCENT_FMT };
