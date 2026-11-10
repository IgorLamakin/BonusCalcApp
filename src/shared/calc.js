/*
 * src/shared/calc.js — единственный источник формул и валидации.
 *
 * Модуль намеренно не зависит ни от Electron, ни от DOM: он загружается
 * и в главном процессе (`require`), и в интерфейсе (`<script src>` → window.Calc),
 * и в тестах. Благодаря этому интерфейс, отчёты и тесты считают одинаково.
 *
 * Методика (согласована с заказчиком 10.11.2026):
 *   маржа           = выручка − закупка − логистика
 *   НДС             = маржа × ставка НДС            («НДС сверху на маржу»)
 *   прибыль до нал. = маржа − НДС
 *   налог           = max(0, прибыль до нал.) × ставка налога
 *   чистая прибыль  = прибыль до нал. − налог
 *   премия          = max(0, чистая прибыль) × процент премии
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Calc = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const MAX_AMOUNT = 1e12;
  const MAX_NAME = 120;

  const DEFAULT_SETTINGS = Object.freeze({
    vatPercent: 20,
    incomeTaxPercent: 20,
    bonusPercent: 30
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const round2 = (value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  };

  const num = (value, fallback) => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  /**
   * Приводит пользовательский ввод к числу.
   * Понимает «1 000,50», «1.000.000», «1,5», «20 %», «−5».
   * Возвращает '' если строку нельзя однозначно прочитать как число.
   */
  function normalizeNumericText(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (value === null || value === undefined) return '';

    let text = String(value).trim();
    if (!text) return '';

    text = text.replace(/[\s\u00a0\u202f]/g, '');
    text = text.replace(/[\u2212\u2013\u2014]/g, '-');

    // Буквы и прочий мусор — это не число («1e3», «две тысячи», «abc»).
    if (/[a-zа-яё]/i.test(text)) return '';

    text = text.replace(/[^\d.,+-]/g, '');
    if (!text || /^[+-]?[.,]?$/.test(text)) return '';

    const hasComma = text.includes(',');
    const hasDot = text.includes('.');

    if (hasComma && hasDot) {
      // Десятичный разделитель — тот, который стоит последним.
      if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
        text = text.replace(/\./g, '').replace(/,/g, '.');
      } else {
        text = text.replace(/,/g, '');
      }
    } else if (hasComma) {
      text = text.replace(/,/g, '.');
    } else if (hasDot) {
      const parts = text.split('.');
      const thousandGroups = parts.slice(1);
      const looksLikeThousands =
        parts.length > 2 && thousandGroups.every((group) => group.length === 3);
      if (looksLikeThousands) text = parts.join('');
    }

    if (text.indexOf('.', text.indexOf('.') + 1) !== -1) return '';

    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : '';
  }

  function parseAmount(value) {
    if (value === '' || value === null || value === undefined) {
      return { ok: true, value: 0, empty: true };
    }
    const parsed = normalizeNumericText(value);
    if (parsed === '') return { ok: false, value: 0, reason: 'Введите число' };
    if (parsed < 0) return { ok: false, value: 0, reason: 'Значение не может быть отрицательным' };
    if (parsed > MAX_AMOUNT) {
      return { ok: false, value: MAX_AMOUNT, reason: 'Слишком большое число' };
    }
    return { ok: true, value: parsed };
  }

  function parsePercent(value, fallback) {
    const def = num(fallback, 0);
    if (value === '' || value === null || value === undefined) {
      return { ok: true, value: def, empty: true };
    }
    const parsed = normalizeNumericText(value);
    if (parsed === '') return { ok: false, value: def, reason: 'Введите число' };
    if (parsed < 0 || parsed > 100) {
      return { ok: false, value: clamp(parsed, 0, 100), reason: 'Допустимо от 0 до 100 %' };
    }
    return { ok: true, value: parsed };
  }

  function cleanName(value) {
    const text = String(value === null || value === undefined ? '' : value)
      // eslint-disable-next-line no-control-regex -- вырезаем управляющие символы и угловые скобки
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .trim()
      .slice(0, MAX_NAME);
    return text;
  }

  /**
   * Проверяет и нормализует входные данные одного расчёта.
   * Используется и в интерфейсе (для отображения), и в главном процессе
   * (чтобы не доверять тому, что пришло по IPC).
   */
  function normalizeInputs(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const type = source.type === 'margin' ? 'margin' : 'deal';
    const vatPercent = clamp(num(source.vatPercent, DEFAULT_SETTINGS.vatPercent), 0, 100);
    const incomeTaxPercent = clamp(
      num(source.incomeTaxPercent, DEFAULT_SETTINGS.incomeTaxPercent),
      0,
      100
    );
    const bonusPercent = clamp(num(source.bonusPercent, DEFAULT_SETTINGS.bonusPercent), 0, 100);

    const input = {
      type,
      vatPercent: round2(vatPercent),
      incomeTaxPercent: round2(incomeTaxPercent),
      bonusPercent: round2(bonusPercent)
    };

    if (type === 'margin') {
      input.managerName = cleanName(source.managerName) || 'Без названия';
      input.margin = round2(clamp(num(source.margin, 0), 0, MAX_AMOUNT));
      input.companyName = '';
      input.revenue = 0;
      input.purchase = 0;
      input.logistics = 0;
    } else {
      input.companyName = cleanName(source.companyName) || 'Без названия';
      input.revenue = round2(clamp(num(source.revenue, 0), 0, MAX_AMOUNT));
      input.purchase = round2(clamp(num(source.purchase, 0), 0, MAX_AMOUNT));
      input.logistics = round2(clamp(num(source.logistics, 0), 0, MAX_AMOUNT));
      input.managerName = '';
      input.margin = 0;
    }

    return input;
  }

  /**
   * Считает результат по нормализованным входным данным.
   * Суммы не округляются — округление только на выводе.
   */
  function compute(rawInputs) {
    const input = normalizeInputs(rawInputs);
    const margin =
      input.type === 'margin' ? input.margin : input.revenue - input.purchase - input.logistics;

    const vat = (margin * input.vatPercent) / 100;
    const profitBeforeTax = margin - vat;
    const incomeTax = (Math.max(0, profitBeforeTax) * input.incomeTaxPercent) / 100;
    const netProfit = profitBeforeTax - incomeTax;
    const bonusBase = Math.max(0, netProfit);
    const bonus = (bonusBase * input.bonusPercent) / 100;

    return {
      type: input.type,
      margin,
      vat,
      profitBeforeTax,
      incomeTax,
      netProfit,
      bonusBase,
      bonus
    };
  }

  function roundResult(result) {
    return {
      type: result.type,
      margin: round2(result.margin),
      vat: round2(result.vat),
      profitBeforeTax: round2(result.profitBeforeTax),
      incomeTax: round2(result.incomeTax),
      netProfit: round2(result.netProfit),
      bonusBase: round2(result.bonusBase),
      bonus: round2(result.bonus)
    };
  }

  function dedupeKey(rawInputs) {
    const input = normalizeInputs(rawInputs);
    const parts =
      input.type === 'margin'
        ? ['margin', input.managerName.toLowerCase(), input.margin]
        : ['deal', input.companyName.toLowerCase(), input.revenue, input.purchase, input.logistics];
    parts.push(input.bonusPercent, input.vatPercent, input.incomeTaxPercent);
    return parts.join('|');
  }

  /** Готовая модель отчёта для Excel/PDF — один источник текстов. */
  function buildReportModel(record) {
    const inputs = normalizeInputs(record && record.inputs ? record.inputs : record);
    const result = compute(inputs);
    const created = record && record.createdAt ? new Date(record.createdAt) : new Date();
    const dateText = Number.isNaN(created.getTime())
      ? new Date().toLocaleDateString('ru-RU')
      : created.toLocaleDateString('ru-RU');

    const isMargin = inputs.type === 'margin';
    const baseInputRows = isMargin
      ? [
          { label: 'Менеджер', value: inputs.managerName, unit: 'text' },
          { label: 'Маржа', value: inputs.margin, unit: 'money' }
        ]
      : [
          { label: 'Компания', value: inputs.companyName, unit: 'text' },
          { label: 'Выручка (с НДС)', value: inputs.revenue, unit: 'money' },
          { label: 'Закупка (с НДС)', value: inputs.purchase, unit: 'money' },
          { label: 'Логистика (с НДС)', value: inputs.logistics, unit: 'money' }
        ];

    return {
      kind: inputs.type,
      title: isMargin
        ? 'Отчёт по расчёту премии менеджера'
        : 'Отчёт по расчёту рентабельности сделки',
      entityLabel: isMargin ? 'Менеджер' : 'Компания',
      entity: isMargin ? inputs.managerName : inputs.companyName,
      dateText,
      inputRows: baseInputRows.concat([
        { label: 'Ставка НДС', value: inputs.vatPercent, unit: 'percent' },
        { label: 'Налог на прибыль', value: inputs.incomeTaxPercent, unit: 'percent' },
        { label: 'Процент премии', value: inputs.bonusPercent, unit: 'percent' }
      ]),
      resultRows: [
        { label: 'Маржа', value: round2(result.margin), unit: 'money', role: 'plain' },
        { label: 'НДС к уплате', value: round2(result.vat), unit: 'money', role: 'deduction' },
        {
          label: 'Налог на прибыль',
          value: round2(result.incomeTax),
          unit: 'money',
          role: 'deduction'
        },
        { label: 'Чистая прибыль', value: round2(result.netProfit), unit: 'money', role: 'net' }
      ],
      total: { label: 'Итоговая премия', value: round2(result.bonus) },
      result: roundResult(result)
    };
  }

  // --- Форматирование (ru-RU) ---
  const moneyFormat = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const intFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

  const formatMoney = (value) => `${moneyFormat.format(round2(num(value, 0)))}\u00a0₽`;

  const formatInt = (value) => intFormat.format(num(value, 0));

  function formatPercent(value) {
    const n = num(value, 0);
    const text = n
      .toFixed(2)
      .replace(/\.00$/, '')
      .replace(/\.(\d)0$/, '.$1');
    return `${text}%`;
  }

  return {
    MAX_AMOUNT,
    MAX_NAME,
    DEFAULT_SETTINGS,
    clamp,
    round2,
    normalizeNumericText,
    parseAmount,
    parsePercent,
    cleanName,
    normalizeInputs,
    compute,
    roundResult,
    dedupeKey,
    buildReportModel,
    formatMoney,
    formatPercent,
    formatInt
  };
});
