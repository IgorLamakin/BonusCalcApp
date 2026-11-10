'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Calc = require('../src/shared/calc.js');

function close(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message || 'значение'}: ожидалось ${expected}, получено ${actual}`
  );
}

const DEAL = {
  type: 'deal',
  companyName: 'ООО «Альфа»',
  revenue: 1200000,
  purchase: 600000,
  logistics: 0,
  bonusPercent: 30,
  vatPercent: 20,
  incomeTaxPercent: 20
};

const MARGIN = {
  type: 'margin',
  managerName: 'Иванов И.И.',
  margin: 100000,
  bonusPercent: 30,
  vatPercent: 20,
  incomeTaxPercent: 20
};

test('расчёт по сделке: базовая методика «НДС сверху на маржу»', () => {
  const r = Calc.compute(DEAL);
  close(r.margin, 600000, 'маржа');
  close(r.vat, 120000, 'НДС');
  close(r.profitBeforeTax, 480000, 'прибыль до налога');
  close(r.incomeTax, 96000, 'налог');
  close(r.netProfit, 384000, 'чистая прибыль');
  close(r.bonus, 115200, 'премия');
});

test('расчёт по марже менеджера', () => {
  const r = Calc.compute(MARGIN);
  close(r.margin, 100000, 'маржа');
  close(r.vat, 20000, 'НДС');
  close(r.profitBeforeTax, 80000, 'прибыль до налога');
  close(r.incomeTax, 16000, 'налог');
  close(r.netProfit, 64000, 'чистая прибыль');
  close(r.bonus, 19200, 'премия');
});

test('нулевые ставки: НДС и налог не удерживаются', () => {
  const r = Calc.compute({ ...DEAL, vatPercent: 0, incomeTaxPercent: 0 });
  close(r.vat, 0, 'НДС');
  close(r.incomeTax, 0, 'налог');
  close(r.netProfit, 600000, 'чистая прибыль');
  close(r.bonus, 180000, 'премия');
});

test('нулевой процент премии даёт нулевую премию', () => {
  const r = Calc.compute({ ...DEAL, bonusPercent: 0 });
  close(r.bonus, 0, 'премия');
  close(r.netProfit, 384000, 'чистая прибыль');
});

test('процент премии 100 % равен чистой прибыли', () => {
  const r = Calc.compute({ ...DEAL, bonusPercent: 100 });
  close(r.bonus, r.netProfit, 'премия');
});

test('убыточная сделка: налог не отрицательный, премия 0', () => {
  const r = Calc.compute({
    type: 'deal',
    companyName: 'Убыток',
    revenue: 100,
    purchase: 200,
    logistics: 0,
    bonusPercent: 30,
    vatPercent: 20,
    incomeTaxPercent: 20
  });
  close(r.margin, -100, 'маржа');
  close(r.vat, -20, 'НДС');
  close(r.profitBeforeTax, -80, 'прибыль до налога');
  assert.equal(r.incomeTax, 0, 'налог при убытке должен быть 0');
  close(r.netProfit, -80, 'чистая прибыль');
  close(r.bonus, 0, 'премия');
});

test('логистика уменьшает маржу', () => {
  const withLogistics = Calc.compute({ ...DEAL, logistics: 100000 });
  close(withLogistics.margin, 500000, 'маржа');
  close(withLogistics.bonus, 96000, 'премия');
});

test('compute не меняет переданный объект', () => {
  const source = { ...DEAL };
  Calc.compute(source);
  assert.deepEqual(source, DEAL);
});

test('normalizeInputs подставляет значения по умолчанию', () => {
  const i = Calc.normalizeInputs({});
  assert.equal(i.type, 'deal');
  assert.equal(i.companyName, 'Без названия');
  assert.equal(i.vatPercent, 20);
  assert.equal(i.incomeTaxPercent, 20);
  assert.equal(i.bonusPercent, 30);
  assert.equal(i.revenue, 0);
});

test('normalizeInputs чистит имя и ограничивает длину', () => {
  const i = Calc.normalizeInputs({ type: 'margin', managerName: '<b>Иван</b>' });
  assert.equal(i.managerName, 'bИван/b');
  const long = Calc.normalizeInputs({ companyName: 'Я'.repeat(500) });
  assert.equal(long.companyName.length, Calc.MAX_NAME);
});

test('normalizeInputs ограничивает суммы и проценты', () => {
  const i = Calc.normalizeInputs({
    revenue: 1e15,
    purchase: -50,
    logistics: 'abc',
    vatPercent: 500,
    incomeTaxPercent: -3,
    bonusPercent: 1000
  });
  assert.equal(i.revenue, Calc.MAX_AMOUNT);
  assert.equal(i.purchase, 0);
  assert.equal(i.logistics, 0);
  assert.equal(i.vatPercent, 100);
  assert.equal(i.incomeTaxPercent, 0);
  assert.equal(i.bonusPercent, 100);
});

test('parseAmount понимает распространённые форматы ввода', () => {
  const cases = [
    ['1 000,50', 1000.5],
    ['1\u00a0000\u00a0500', 1000500],
    ['1.000.000', 1000000],
    ['1,5', 1.5],
    ['0,25', 0.25],
    ['1200.75', 1200.75],
    [' 42 ', 42],
    ['20 %', 20],
    ['-5', null],
    ['abc', null],
    ['1e3', null],
    ['', 0]
  ];
  for (const [input, expected] of cases) {
    const got = Calc.parseAmount(input);
    if (expected === null) {
      assert.equal(got.ok, false, `«${input}» должно считаться ошибкой`);
    } else {
      assert.equal(got.ok, true, `«${input}» должно считаться числом`);
      close(got.value, expected, `«${input}»`);
    }
  }
});

test('parseAmount помечает пустое поле как empty, а не ошибку', () => {
  const r = Calc.parseAmount('');
  assert.equal(r.ok, true);
  assert.equal(r.empty, true);
  assert.equal(r.value, 0);
});

test('parsePercent проверяет диапазон 0–100', () => {
  assert.equal(Calc.parsePercent('20', 20).value, 20);
  assert.equal(Calc.parsePercent('20,5', 20).value, 20.5);
  assert.equal(Calc.parsePercent('', 15).value, 15);
  const tooBig = Calc.parsePercent('150', 20);
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.value, 100);
  assert.equal(Calc.parsePercent('-1', 20).ok, false);
});

test('dedupeKey не зависит от порядка и регистра имени', () => {
  const a = Calc.dedupeKey({ ...DEAL, companyName: 'ООО Альфа' });
  const b = Calc.dedupeKey({ ...DEAL, companyName: 'ооо альфа' });
  assert.equal(a, b);
});

test('dedupeKey учитывает ставки и суммы', () => {
  const base = Calc.dedupeKey(DEAL);
  assert.notEqual(base, Calc.dedupeKey({ ...DEAL, vatPercent: 10 }));
  assert.notEqual(base, Calc.dedupeKey({ ...DEAL, revenue: 1200001 }));
  assert.notEqual(base, Calc.dedupeKey({ ...DEAL, type: 'margin' }));
});

test('roundResult округляет деньги до копеек', () => {
  const r = Calc.roundResult({
    type: 'deal',
    margin: 100.005,
    vat: 20.001,
    profitBeforeTax: 80.004,
    incomeTax: 16.0008,
    netProfit: 64.0032,
    bonusBase: 64.0032,
    bonus: 19.20096
  });
  assert.equal(r.margin, 100.01);
  assert.equal(r.vat, 20);
  assert.equal(r.bonus, 19.2);
});

test('buildReportModel: строки отчёта полные и в правильном порядке', () => {
  const model = Calc.buildReportModel({
    inputs: DEAL,
    createdAt: '2026-11-10T10:00:00.000Z'
  });
  assert.equal(model.kind, 'deal');
  assert.equal(model.entity, 'ООО «Альфа»');
  assert.equal(model.dateText, '10.11.2026');

  const inputLabels = model.inputRows.map((r) => r.label);
  assert.deepEqual(inputLabels, [
    'Компания',
    'Выручка (с НДС)',
    'Закупка (с НДС)',
    'Логистика (с НДС)',
    'Ставка НДС',
    'Налог на прибыль',
    'Процент премии'
  ]);

  const resultLabels = model.resultRows.map((r) => r.label);
  assert.deepEqual(resultLabels, ['Маржа', 'НДС к уплате', 'Налог на прибыль', 'Чистая прибыль']);
  assert.equal(model.total.label, 'Итоговая премия');
  close(model.total.value, 115200, 'итоговая премия');
});

test('buildReportModel для расчёта по марже', () => {
  const model = Calc.buildReportModel({ inputs: MARGIN });
  assert.equal(model.kind, 'margin');
  assert.equal(model.entity, 'Иванов И.И.');
  assert.equal(model.inputRows[0].label, 'Менеджер');
  close(model.total.value, 19200, 'итоговая премия');
});

test('форматирование сумм и процентов', () => {
  const money = Calc.formatMoney(115200).replace(/\u00a0/g, ' ');
  assert.equal(money, '115 200,00 ₽');
  assert.equal(Calc.formatPercent(30), '30%');
  assert.equal(Calc.formatPercent(20.5), '20.5%');
  assert.equal(Calc.formatPercent(20.05), '20.05%');
});
