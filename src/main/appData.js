'use strict';

/**
 * Слой данных приложения: настройки и история расчётов.
 *
 * Формат файлов версионирован (schemaVersion), старые файлы читаются
 * и автоматически переводятся в новый формат.
 */

const path = require('path');
const crypto = require('crypto');
const Calc = require('../shared/calc');
const { JsonStore } = require('./store');

const SCHEMA_VERSION = 2;
const HISTORY_LIMIT = 100;

const DEFAULT_WINDOW = Object.freeze({
  width: 480,
  height: 860,
  x: null,
  y: null,
  maximized: false
});

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  vatPercent: Calc.DEFAULT_SETTINGS.vatPercent,
  incomeTaxPercent: Calc.DEFAULT_SETTINGS.incomeTaxPercent,
  bonusPercent: Calc.DEFAULT_SETTINGS.bonusPercent,
  lastSaveDir: '',
  window: DEFAULT_WINDOW
});

function asFiniteNumber(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function percent(value, fallback) {
  return Calc.round2(Calc.clamp(asFiniteNumber(value, fallback), 0, 100));
}

function normalizeWindow(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const width = Math.round(asFiniteNumber(src.width, DEFAULT_WINDOW.width));
  const height = Math.round(asFiniteNumber(src.height, DEFAULT_WINDOW.height));
  const x = Number.isFinite(Number(src.x)) ? Math.round(Number(src.x)) : null;
  const y = Number.isFinite(Number(src.y)) ? Math.round(Number(src.y)) : null;
  return {
    width: Calc.clamp(width, 420, 4000),
    height: Calc.clamp(height, 640, 3000),
    x: x === null ? null : Calc.clamp(x, -10000, 10000),
    y: y === null ? null : Calc.clamp(y, -10000, 10000),
    maximized: Boolean(src.maximized)
  };
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    vatPercent: percent(src.vatPercent, DEFAULT_SETTINGS.vatPercent),
    incomeTaxPercent: percent(src.incomeTaxPercent, DEFAULT_SETTINGS.incomeTaxPercent),
    bonusPercent: percent(src.bonusPercent, DEFAULT_SETTINGS.bonusPercent),
    lastSaveDir: typeof src.lastSaveDir === 'string' ? src.lastSaveDir : '',
    window: normalizeWindow(src.window)
  };
}

function migrateSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const migrated = { ...src };
  // В версии 1.0 настройка папки сохранения называлась saveDir и не использовалась.
  if (!migrated.lastSaveDir && typeof migrated.saveDir === 'string') {
    migrated.lastSaveDir = migrated.saveDir;
  }
  delete migrated.saveDir;
  return normalizeSettings(migrated);
}

/** Старая (плоская) запись истории → запись версии 2. */
function migrateRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.inputs && record.result) {
    return {
      id: typeof record.id === 'string' && record.id ? record.id : crypto.randomUUID(),
      type: record.type === 'margin' ? 'margin' : 'deal',
      createdAt: record.createdAt || new Date().toISOString(),
      inputs: record.inputs,
      result: record.result
    };
  }
  const legacyType = record.type === 'margin' ? 'margin' : 'deal';
  const inputs =
    legacyType === 'margin'
      ? {
          type: 'margin',
          managerName: record.managerName,
          margin: record.margin,
          bonusPercent: record.bonusPercent,
          vatPercent: record.vatPercent,
          incomeTaxPercent: record.incomeTaxPercent
        }
      : {
          type: 'deal',
          companyName: record.companyName,
          revenue: record.revenue,
          purchase: record.purchase,
          logistics: record.logistics,
          bonusPercent: record.bonusPercent,
          vatPercent: record.vatPercent,
          incomeTaxPercent: record.incomeTaxPercent
        };
  return {
    id: typeof record.id === 'string' && record.id ? record.id : crypto.randomUUID(),
    type: legacyType,
    createdAt: record.createdAt || new Date().toISOString(),
    inputs,
    result: null
  };
}

function normalizeHistory(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(src.items) ? src.items : Array.isArray(raw) ? raw : [];
  const items = [];
  const seen = new Set();

  for (const candidate of list) {
    const migrated = migrateRecord(candidate);
    if (!migrated) continue;
    const inputs = Calc.normalizeInputs(migrated.inputs);
    const key = Calc.dedupeKey(inputs);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: migrated.id,
      key,
      type: inputs.type,
      createdAt: migrated.createdAt,
      inputs,
      result: Calc.roundResult(Calc.compute(inputs))
    });
    if (items.length >= HISTORY_LIMIT) break;
  }

  return { schemaVersion: SCHEMA_VERSION, items };
}

function migrateHistory(raw) {
  if (Array.isArray(raw)) return normalizeHistory({ items: raw });
  const src = raw && typeof raw === 'object' ? raw : {};
  return normalizeHistory(src);
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    text = value.toFixed(2).replace('.', ',');
  }
  if (/[";\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvMoney(value) {
  return (Math.round((asFiniteNumber(value, 0) + Number.EPSILON) * 100) / 100)
    .toFixed(2)
    .replace('.', ',');
}

const CSV_COLUMNS = [
  'Дата',
  'Тип расчёта',
  'Компания / менеджер',
  'Выручка',
  'Закупка',
  'Логистика',
  'Маржа',
  'Ставка НДС, %',
  'Налог на прибыль, %',
  'Процент премии, %',
  'НДС',
  'Налог на прибыль',
  'Чистая прибыль',
  'Премия'
];

function historyToCsv(items) {
  const lines = [CSV_COLUMNS.join(';')];
  for (const item of items) {
    const i = item.inputs;
    const r = item.result || Calc.compute(i);
    const date = new Date(item.createdAt);
    lines.push(
      [
        csvCell(Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU')),
        item.type === 'margin' ? 'По марже' : 'По сделке',
        csvCell(item.type === 'margin' ? i.managerName : i.companyName),
        csvMoney(i.revenue),
        csvMoney(i.purchase),
        csvMoney(i.logistics),
        csvMoney(r.margin),
        csvCell(i.vatPercent),
        csvCell(i.incomeTaxPercent),
        csvCell(i.bonusPercent),
        csvMoney(r.vat),
        csvMoney(r.incomeTax),
        csvMoney(r.netProfit),
        csvMoney(r.bonus)
      ].join(';')
    );
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

function createStores(userDataDir) {
  const settings = new JsonStore(path.join(userDataDir, 'settings.json'), {
    defaults: DEFAULT_SETTINGS,
    migrate: migrateSettings,
    normalize: normalizeSettings
  });

  const historyStore = new JsonStore(path.join(userDataDir, 'history.json'), {
    defaults: { schemaVersion: SCHEMA_VERSION, items: [] },
    migrate: migrateHistory,
    normalize: normalizeHistory
  });

  const history = {
    /** @returns {{items: any[], recovered: boolean}} */
    list() {
      historyStore.load();
      return { items: historyStore.get().items, recovered: historyStore.recovered };
    },

    add(rawInputs) {
      const inputs = Calc.normalizeInputs(rawInputs);
      const key = Calc.dedupeKey(inputs);
      const now = new Date().toISOString();
      const current = historyStore.load().items.slice();
      const existingIndex = current.findIndex((item) => item.key === key);
      const result = Calc.roundResult(Calc.compute(inputs));

      if (existingIndex >= 0) {
        const existing = current[existingIndex];
        current.splice(existingIndex, 1);
        current.unshift({ ...existing, createdAt: now, inputs, result });
      } else {
        current.unshift({
          id: crypto.randomUUID(),
          key,
          type: inputs.type,
          createdAt: now,
          inputs,
          result
        });
      }

      const items = current.slice(0, HISTORY_LIMIT);
      historyStore.set({ schemaVersion: SCHEMA_VERSION, items });
      return { items };
    },

    remove(id) {
      const target = String(id || '');
      const items = historyStore.load().items.filter((item) => item.id !== target);
      historyStore.set({ schemaVersion: SCHEMA_VERSION, items });
      return { items };
    },

    clear() {
      historyStore.set({ schemaVersion: SCHEMA_VERSION, items: [] });
      return { items: [] };
    },

    toCsv() {
      return historyToCsv(historyStore.load().items);
    }
  };

  return { settings, history };
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_WINDOW,
  HISTORY_LIMIT,
  SCHEMA_VERSION,
  createStores,
  historyToCsv,
  migrateHistory,
  migrateRecord,
  migrateSettings,
  normalizeHistory,
  normalizeSettings
};
