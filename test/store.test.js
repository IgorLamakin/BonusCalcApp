'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { JsonStore } = require('../src/main/store');
const {
  createStores,
  historyToCsv,
  migrateRecord,
  migrateSettings,
  normalizeSettings,
  HISTORY_LIMIT
} = require('../src/main/appData');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bonuscalc-test-'));
}

test('JsonStore: значения по умолчанию и сохранение между запусками', () => {
  const dir = tempDir();
  const file = path.join(dir, 'data.json');

  const first = new JsonStore(file, { defaults: { a: 1 } });
  assert.deepEqual(first.get(), { a: 1 });
  first.set({ a: 2, b: 'x' });

  const second = new JsonStore(file, { defaults: { a: 1 } });
  assert.deepEqual(second.get(), { a: 2, b: 'x' });
  assert.equal(second.recovered, false);
});

test('JsonStore: при повреждённом основном файле берётся резервная копия', () => {
  const dir = tempDir();
  const file = path.join(dir, 'data.json');

  const store = new JsonStore(file, { defaults: { a: 1 } });
  store.set({ a: 2 });
  store.set({ a: 3 }); // предыдущая версия {a:2} уехала в .bak

  fs.writeFileSync(file, '{ битый json', 'utf8');

  const restored = new JsonStore(file, { defaults: { a: 1 } });
  assert.deepEqual(restored.get(), { a: 2 });
  assert.equal(restored.recovered, true);
  // восстановленный файл перезаписан валидным JSON
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
});

test('JsonStore: если повреждены оба файла — значения по умолчанию и флаг восстановления', () => {
  const dir = tempDir();
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, 'не json', 'utf8');
  fs.writeFileSync(`${file}.bak`, 'тоже не json', 'utf8');

  const store = new JsonStore(file, { defaults: { a: 1 } });
  assert.deepEqual(store.get(), { a: 1 });
  assert.equal(store.recovered, true);
});

test('JsonStore: update меняет данные и сохраняет', () => {
  const dir = tempDir();
  const file = path.join(dir, 'data.json');
  const store = new JsonStore(file, { defaults: { count: 0 } });
  store.update((data) => ({ ...data, count: data.count + 1 }));
  assert.equal(store.get().count, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).count, 1);
});

test('настройки: старый saveDir переезжает в lastSaveDir', () => {
  const migrated = migrateSettings({ vatPercent: 22, incomeTaxPercent: 25, saveDir: 'D:\\Отчёты' });
  assert.equal(migrated.saveDir, undefined);
  assert.equal(migrated.lastSaveDir, 'D:\\Отчёты');
  assert.equal(migrated.vatPercent, 22);
  assert.equal(migrated.incomeTaxPercent, 25);
  assert.equal(migrated.bonusPercent, 30);
  assert.equal(migrated.window.width, 480);
});

test('настройки: некорректные значения приводятся к допустимым', () => {
  const settings = normalizeSettings({
    vatPercent: 500,
    incomeTaxPercent: -10,
    bonusPercent: 'abc',
    window: { width: 10, height: 99999, x: 'x', y: null, maximized: 'yes' }
  });
  assert.equal(settings.vatPercent, 100);
  assert.equal(settings.incomeTaxPercent, 0);
  assert.equal(settings.bonusPercent, 30);
  assert.equal(settings.window.width, 420);
  assert.equal(settings.window.height, 3000);
  assert.equal(settings.window.x, null);
  assert.equal(settings.window.maximized, true);
});

test('история: старая плоская запись переводится в новый формат', () => {
  const record = migrateRecord({
    id: 'abc',
    type: 'standard',
    companyName: 'ООО Ромашка',
    revenue: 100,
    purchase: 50,
    logistics: 10,
    bonusPercent: '30',
    vatPercent: 20,
    incomeTaxPercent: 20,
    createdAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(record.id, 'abc');
  assert.equal(record.type, 'deal');
  assert.equal(record.inputs.companyName, 'ООО Ромашка');
  assert.equal(record.inputs.revenue, 100);
});

test('история: добавление, дедупликация и лимит', () => {
  const dir = tempDir();
  const { history } = createStores(dir);

  const base = {
    type: 'deal',
    companyName: 'ООО Альфа',
    revenue: 1200000,
    purchase: 600000,
    logistics: 0,
    bonusPercent: 30,
    vatPercent: 20,
    incomeTaxPercent: 20
  };

  let state = history.add(base);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].result.bonus, 115200);

  // тот же расчёт — запись обновляется, а не дублируется
  state = history.add({ ...base, companyName: 'ооо альфа' });
  assert.equal(state.items.length, 1);

  // другой расчёт — новая запись сверху
  state = history.add({ ...base, revenue: 2000000 });
  assert.equal(state.items.length, 2);
  assert.equal(state.items[0].inputs.revenue, 2000000);

  // лимит истории
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
    state = history.add({ ...base, companyName: `Компания ${i}` });
  }
  assert.equal(state.items.length, HISTORY_LIMIT);

  state = history.remove(state.items[0].id);
  assert.equal(state.items.length, HISTORY_LIMIT - 1);

  state = history.clear();
  assert.deepEqual(state.items, []);
});

test('история: повторное открытие читает сохранённые записи', () => {
  const dir = tempDir();
  const first = createStores(dir);
  first.history.add({
    type: 'margin',
    managerName: 'Петров',
    margin: 100000,
    bonusPercent: 25,
    vatPercent: 20,
    incomeTaxPercent: 20
  });

  const second = createStores(dir);
  const state = second.history.list();
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].inputs.managerName, 'Петров');
  assert.equal(state.items[0].result.bonus, 16000);
});

test('CSV истории: заголовки, BOM и разделитель «;»', () => {
  const csv = historyToCsv([
    {
      type: 'deal',
      createdAt: '2026-11-10T10:00:00.000Z',
      inputs: {
        type: 'deal',
        companyName: 'ООО "Альфа"; тест',
        revenue: 1200000,
        purchase: 600000,
        logistics: 0,
        bonusPercent: 30,
        vatPercent: 20,
        incomeTaxPercent: 20
      },
      result: { margin: 600000, vat: 120000, incomeTax: 96000, netProfit: 384000, bonus: 115200 }
    }
  ]);

  assert.ok(csv.startsWith('\ufeff'), 'есть BOM для Excel');
  const lines = csv.replace('\ufeff', '').trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('Дата;Тип расчёта;Компания / менеджер'));
  assert.ok(lines[1].includes('"ООО ""Альфа""; тест"'), 'кавычки экранируются');
  assert.ok(lines[1].includes('115200,00'), 'числа с десятичной запятой');
});
