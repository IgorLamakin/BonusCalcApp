'use strict';

/** Формирование PDF-отчёта из модели отчёта (см. Calc.buildReportModel). */

const fs = require('fs');
const PDFDocument = require('pdfkit');

const COLORS = {
  title: '#0F172A',
  label: '#475569',
  value: '#0F172A',
  accent: '#1F4ED8',
  section: '#1F4ED8',
  totalText: '#92400E',
  totalFill: '#FEF3C7',
  footer: '#94A3B8',
  rule: '#E2E8F0'
};

class FontMissingError extends Error {
  constructor(fontPath) {
    super(`Не найден шрифт отчёта: ${fontPath}`);
    this.code = 'FONT_MISSING';
  }
}

function createPdfBuffer(model, options = {}) {
  const { fontPath, appName = 'Калькулятор премии', version = '' } = options;

  return new Promise((resolve, reject) => {
    if (!fontPath || !fs.existsSync(fontPath)) {
      reject(new FontMissingError(fontPath));
      return;
    }

    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      bufferPages: true,
      info: {
        Title: model.title,
        Author: appName,
        Creator: `${appName}${version ? ' v' + version : ''}`
      }
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.registerFont('Body', fontPath);
    } catch (err) {
      reject(err);
      return;
    }

    const left = doc.page.margins.left;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottomLimit = doc.page.height - doc.page.margins.bottom - 40;

    const setFont = (size, color) => {
      doc.font('Body').fontSize(size).fillColor(color);
    };

    const ensureSpace = (needed) => {
      if (doc.y + needed <= bottomLimit) return;
      doc.addPage();
      doc.y = doc.page.margins.top;
    };

    const drawRule = (color = COLORS.rule, width = 0.75) => {
      doc
        .moveTo(left, doc.y)
        .lineTo(left + contentWidth, doc.y)
        .lineWidth(width)
        .strokeColor(color)
        .stroke();
    };

    const drawSection = (title) => {
      ensureSpace(46);
      doc.moveDown(0.7);
      setFont(9, COLORS.section);
      doc.text(title.toUpperCase(), left, doc.y, { width: contentWidth, characterSpacing: 0.6 });
      doc.moveDown(0.2);
      drawRule(COLORS.rule);
      doc.moveDown(0.4);
    };

    const drawRow = (label, value, opts = {}) => {
      const rowHeight = opts.height || 19;
      ensureSpace(rowHeight + 4);
      const top = doc.y;
      setFont(opts.size || 11, opts.labelColor || COLORS.label);
      doc.text(label, left, top, { width: contentWidth * 0.62, lineBreak: false });
      setFont(opts.size || 11, opts.valueColor || COLORS.value);
      doc.text(String(value), left + contentWidth * 0.62, top, {
        width: contentWidth * 0.38,
        align: 'right',
        lineBreak: false
      });
      doc.y = top + rowHeight;
    };

    const formatMoney = (value) => {
      const n = Number(value) || 0;
      return `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0₽`;
    };
    const formatPercent = (value) => `${Number(value) || 0}\u00a0%`;

    // --- Заголовок ---
    doc.y = doc.page.margins.top;
    setFont(17, COLORS.title);
    doc.text(model.title, left, doc.y, { width: contentWidth, align: 'center' });
    doc.moveDown(0.35);
    setFont(10, COLORS.accent);
    doc.text(`${model.entityLabel}: ${model.entity}`, left, doc.y, {
      width: contentWidth,
      align: 'center'
    });
    doc.moveDown(0.15);
    setFont(9, COLORS.footer);
    doc.text(`Дата расчёта: ${model.dateText}`, left, doc.y, {
      width: contentWidth,
      align: 'center'
    });
    doc.moveDown(0.8);
    drawRule(COLORS.accent, 1.2);
    doc.moveDown(0.6);

    // --- Исходные данные ---
    drawSection('Исходные данные');
    for (const item of model.inputRows) {
      const value =
        item.unit === 'money'
          ? formatMoney(item.value)
          : item.unit === 'percent'
            ? formatPercent(item.value)
            : String(item.value);
      drawRow(item.label, value);
    }

    // --- Результаты ---
    drawSection('Результаты расчёта');
    for (const item of model.resultRows) {
      const isDeduction = item.role === 'deduction';
      const isNet = item.role === 'net';
      const value = formatMoney(item.value);
      drawRow(item.label, isDeduction && item.value > 0 ? `−\u00a0${value}` : value, {
        size: isNet ? 12 : 11,
        valueColor: isNet ? '#15803D' : COLORS.value
      });
    }

    // --- Итог ---
    ensureSpace(80);
    doc.moveDown(0.7);
    const boxTop = doc.y;
    const boxHeight = 54;
    doc.roundedRect(left, boxTop, contentWidth, boxHeight, 10).fill(COLORS.totalFill);
    setFont(11, COLORS.totalText);
    doc.text(model.total.label, left + 16, boxTop + 19, { width: contentWidth - 32 });
    setFont(18, COLORS.totalText);
    doc.text(formatMoney(model.total.value), left + 16, boxTop + 16, {
      width: contentWidth - 32,
      align: 'right'
    });
    doc.y = boxTop + boxHeight + 12;

    // --- Подвал ---
    ensureSpace(30);
    setFont(8, COLORS.footer);
    doc.text(
      `Сформировано в приложении «${appName}»${version ? ' v' + version : ''}`,
      left,
      doc.page.height - doc.page.margins.bottom - 14,
      { width: contentWidth }
    );

    doc.end();
  });
}

module.exports = { createPdfBuffer, FontMissingError };
