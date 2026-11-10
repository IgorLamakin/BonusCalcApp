'use strict';

/**
 * Автоматическая проверка «приложение запускается и считает правильно».
 * Запуск: npm run smoke (electron . --smoke). В сборку не входит.
 */

const path = require('path');
const { app } = require('electron');
const Calc = require('../shared/calc');
const { createXlsxBuffer } = require('./exporters/excel');
const { createPdfBuffer } = require('./exporters/pdf');

const SCENARIO = `(async () => {
  const byId = (id) => document.getElementById(id);
  const setValue = (id, value) => {
    const el = byId(id);
    if (!el) throw new Error('Нет поля #' + id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const readNumber = (id) => {
    const text = String(byId(id).textContent || '');
    const normalized = text.replace(/[^0-9,-]/g, '').replace(/\\s/g, '').replace(',', '.');
    return normalized ? Number(normalized) : NaN;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms || 150));
  const result = { features: {}, deal: null, margin: null, validation: null, history: 0, slider: null };

  result.features.api = typeof window.api;
  result.features.calc = typeof window.Calc;
  result.features.require = typeof window.require;
  result.features.sliderGradient =
    getComputedStyle(byId('bonusPercent')).backgroundImage.indexOf('gradient') !== -1;
  const logoImage = byId('logoImg');
  result.features.logoLoaded = Boolean(logoImage && logoImage.complete && logoImage.naturalWidth > 0);

  const updateState = await window.api.updateState();
  result.update = updateState && updateState.view ? updateState.view : null;

  setValue('companyName', 'ООО «Смоук»');
  setValue('revenue', '1 200 000');
  setValue('purchase', '600000');
  setValue('logistics', '0');
  setValue('bonusPercentInput', '30');
  setValue('vatPercent', '20');
  setValue('incomeTaxPercent', '20');
  byId('btnCalc').click();
  await wait();

  const sliderBackground = byId('bonusPercent').style.background || '';
  result.slider = { label: byId('bonusPercentInput').value, background: sliderBackground.indexOf('gradient') !== -1 };
  result.deal = {
    margin: readNumber('resMargin'),
    vat: readNumber('resVat'),
    tax: readNumber('resTax'),
    profit: readNumber('resProfit'),
    bonus: readNumber('resBonus'),
    resultsVisible: !byId('results').classList.contains('hidden')
  };

  byId('tab2').click();
  await wait(80);
  setValue('managerName', 'Иванов И.И.');
  setValue('margin2', '100000');
  setValue('bonusPercent2Input', '30');
  byId('btnCalc2').click();
  await wait();
  result.margin = {
    vat: readNumber('resVat2'),
    tax: readNumber('resTax2'),
    profit: readNumber('resProfit2'),
    bonus: readNumber('resBonus2')
  };

  byId('tab1').click();
  await wait(80);
  setValue('revenue', '-5');
  byId('btnCalc').click();
  await wait();
  const revenueError = byId('revenueError');
  result.validation = {
    marked: byId('revenue').classList.contains('field-invalid'),
    message: revenueError ? revenueError.textContent : '',
    ariaInvalid: byId('revenue').getAttribute('aria-invalid')
  };
  setValue('revenue', '1200000');

  await wait(250);
  result.history = document.querySelectorAll('#histList .hitem').length;
  result.debug = {
    toast: (byId('toast').textContent || '').slice(0, 160),
    errors: Array.prototype.map
      .call(document.querySelectorAll('.field-error'), (node) => node.textContent)
      .filter(Boolean),
    marginResults: (byId('results2').textContent || '').replace(/\\s+/g, ' ').slice(0, 160)
  };
  return result;
})()`;

function waitForLoad(win) {
  if (!win.webContents.isLoading()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Страница не загрузилась за 30 секунд')),
      30000
    );
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
    win.webContents.once('did-fail-load', (_event, code, description) => {
      clearTimeout(timer);
      reject(new Error(`Не удалось загрузить страницу: ${code} ${description}`));
    });
  });
}

function nearlyEqual(actual, expected, epsilon = 0.02) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
}

async function runSmokeTest(win) {
  const checks = [];
  const check = (name, condition, detail) => {
    checks.push({ name, ok: Boolean(condition), detail });
    console.log(
      `${condition ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`
    );
  };

  try {
    await waitForLoad(win);
    const ui = await win.webContents.executeJavaScript(SCENARIO, true);

    check('интерфейс: мост window.api доступен', ui.features.api === 'object', ui.features.api);
    check('интерфейс: общий модуль Calc загружен', ui.features.calc === 'object', ui.features.calc);
    check(
      'безопасность: window.require недоступен',
      ui.features.require === 'undefined',
      ui.features.require
    );
    check('стили: заливка слайдера работает', ui.features.sliderGradient, null);
    check('интерфейс: логотип загрузился (CSP не блокирует)', ui.features.logoLoaded, null);
    check(
      'обновления: в режиме разработки корректно отключены',
      Boolean(ui.update) &&
        ui.update.visible === false &&
        /установленной/.test(ui.update.toast || ''),
      ui.update && ui.update.toast
    );
    check(
      'стили: ползунок перекрашивается из JS',
      ui.slider.background === true,
      ui.slider.background
    );

    check('расчёт по сделке: маржа', nearlyEqual(ui.deal.margin, 600000), ui.deal.margin);
    check('расчёт по сделке: НДС', nearlyEqual(ui.deal.vat, 120000), ui.deal.vat);
    check('расчёт по сделке: налог', nearlyEqual(ui.deal.tax, 96000), ui.deal.tax);
    check('расчёт по сделке: чистая прибыль', nearlyEqual(ui.deal.profit, 384000), ui.deal.profit);
    check('расчёт по сделке: премия', nearlyEqual(ui.deal.bonus, 115200), ui.deal.bonus);
    check('расчёт по сделке: результаты показаны', ui.deal.resultsVisible, null);

    check('расчёт по марже: НДС', nearlyEqual(ui.margin.vat, 20000), ui.margin.vat);
    check('расчёт по марже: налог', nearlyEqual(ui.margin.tax, 16000), ui.margin.tax);
    check(
      'расчёт по марже: чистая прибыль',
      nearlyEqual(ui.margin.profit, 64000),
      ui.margin.profit
    );
    check('расчёт по марже: премия', nearlyEqual(ui.margin.bonus, 19200), ui.margin.bonus);

    check('валидация: поле подсвечено', ui.validation.marked, null);
    check('валидация: есть текст ошибки', Boolean(ui.validation.message), ui.validation.message);
    check(
      'валидация: aria-invalid выставлен',
      ui.validation.ariaInvalid === 'true',
      ui.validation.ariaInvalid
    );

    check(
      'слайдер: подпись синхронизирована',
      ui.slider.label.indexOf('30') !== -1,
      ui.slider.label
    );
    check('история: две записи, ошибка ввода не добавила запись', ui.history === 2, ui.history);

    if (ui.debug) {
      const hasNoise = ui.debug.toast || (ui.debug.errors && ui.debug.errors.length);
      if (hasNoise) console.log('DEBUG ' + JSON.stringify(ui.debug));
    }

    const inputs = {
      type: 'deal',
      companyName: 'ООО «Смоук»',
      revenue: 1200000,
      purchase: 600000,
      logistics: 0,
      bonusPercent: 30,
      vatPercent: 20,
      incomeTaxPercent: 20
    };
    const model = Calc.buildReportModel({ inputs, createdAt: new Date().toISOString() });

    const xlsx = await createXlsxBuffer(model, { appName: 'Смоук-тест', version: '0.0.0' });
    check('экспорт Excel: файл собран', xlsx.length > 5000, xlsx.length);

    const pdf = await createPdfBuffer(model, {
      fontPath: path.join(app.getAppPath(), 'font.ttf'),
      appName: 'Смоук-тест',
      version: '0.0.0'
    });
    check('экспорт PDF: файл собран', pdf.length > 3000, pdf.length);
    check(
      'экспорт PDF: настоящий PDF',
      pdf.subarray(0, 4).toString() === '%PDF',
      pdf.subarray(0, 4).toString()
    );
  } catch (err) {
    check('исключение во время проверки', false, String((err && err.stack) || err));
  }

  const failed = checks.filter((item) => !item.ok);
  console.log(`\nИтого: ${checks.length - failed.length} из ${checks.length} проверок пройдено`);
  if (failed.length) {
    console.log('Провалено: ' + failed.map((item) => item.name).join('; '));
  }
  return failed.length === 0;
}

module.exports = { runSmokeTest };
