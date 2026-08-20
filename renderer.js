// Весь JS интерфейса вынесен в отдельный файл,
// потому что CSP (script-src 'self') запрещает inline-скрипты.
// Взаимодействие с системой — через безопасный мост window.api (preload).
// ВАЖНО: contextBridge.exposeInMainWorld('api', ...) уже создаёт глобальную
// переменную `api` в окне, поэтому нельзя объявлять `const api` повторно.
// Используем локальный псевдоним `bridge`.

'use strict';

const bridge = window.api;

let lastCalculation = null;
let slider = null;
let slider2 = null;
let historyCache = [];

function fmt(n) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

function fmtInt(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

function paintSlider(val) {
  if (!slider) return;
  const min = +slider.min, max = +slider.max;
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.background =
    `linear-gradient(90deg, #4f8cff 0%, #4f8cff ${pct}%, rgba(148,163,184,.25) ${pct}%)`;
}

function updatePercentLabel(val) {
  const el = document.getElementById('bonusPercentLabel');
  if (el) el.textContent = val + '%';
  paintSlider(val);
}

function paintSlider2(val) {
  if (!slider2) return;
  const min = +slider2.min, max = +slider2.max;
  const pct = ((val - min) / (max - min)) * 100;
  slider2.style.background =
    `linear-gradient(90deg, #4f8cff 0%, #4f8cff ${pct}%, rgba(148,163,184,.25) ${pct}%)`;
}

function updatePercentLabel2(val) {
  const el = document.getElementById('bonusPercent2Label');
  if (el) el.textContent = val + '%';
  paintSlider2(val);
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

// --- Настройки ставок (сохраняются в localStorage + main-процесс) ---
const SETTINGS_KEY = 'bonuscalc_settings';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { vatPercent: 20, incomeTaxPercent: 20 };
}

function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) { /* ignore */ }
  if (bridge && bridge.settingsSave) {
    bridge.settingsSave(s).catch(() => { });
  }
}

function applySettingsToUI(s) {
  const vp = ((s && s.vatPercent) ?? 20).toFixed(1).replace(/\.0$/, '');
  const itp = ((s && s.incomeTaxPercent) ?? 20).toFixed(1).replace(/\.0$/, '');
  const el = document.getElementById('vatPercent');
  const el2 = document.getElementById('incomeTaxPercent');
  const el3 = document.getElementById('vatPercent2');
  const el4 = document.getElementById('incomeTaxPercent2');
  if (el) el.value = vp;
  if (el2) el2.value = itp;
  if (el3) el3.value = vp;
  if (el4) el4.value = itp;
}

function readSettingsInputs() {
  const el = document.getElementById('vatPercent');
  const el2 = document.getElementById('incomeTaxPercent');
  const vatP = parseFloat(el && el.value) || 20;
  const taxP = parseFloat(el2 && el2.value) || 20;
  return {
    vatPercent: Math.min(100, Math.max(0, vatP)),
    incomeTaxPercent: Math.min(100, Math.max(0, taxP))
  };
}

function readSettingsInputs2() {
  const el = document.getElementById('vatPercent2');
  const el2 = document.getElementById('incomeTaxPercent2');
  const vatP = parseFloat(el && el.value) || 20;
  const taxP = parseFloat(el2 && el2.value) || 20;
  return {
    vatPercent: Math.min(100, Math.max(0, vatP)),
    incomeTaxPercent: Math.min(100, Math.max(0, taxP))
  };
}

function showFieldError(el, show) {
  if (!el) return;
  el.classList.toggle('input-error', show);
  if (show) {
    el.setAttribute('title', 'Введите значение от 0 до 100');
  } else {
    el.removeAttribute('title');
  }
}

function readInputs() {
  const companyName = document.getElementById('companyName').value.trim() || 'Без названия';
  const revenueEl = document.getElementById('revenue');
  const purchaseEl = document.getElementById('purchase');
  const logisticsEl = document.getElementById('logistics');
  const revenue = parseFloat(revenueEl.value) || 0;
  const purchase = parseFloat(purchaseEl.value) || 0;
  const logistics = parseFloat(logisticsEl.value) || 0;
  const bonusPercent = parseFloat(document.getElementById('bonusPercent').value) / 100;
  showFieldError(revenueEl, false);
  showFieldError(purchaseEl, false);
  showFieldError(logisticsEl, false);
  return { companyName, revenue, purchase, logistics, bonusPercent };
}

function calculate(saveToHistory) {
  try {
    const { companyName, revenue, purchase, logistics, bonusPercent } = readInputs();
    const settings = readSettingsInputs();

    const margin = revenue - purchase - logistics;
    const vat = margin * (settings.vatPercent / 100);
    const profitBeforeTax = margin - vat;
    const incomeTax = profitBeforeTax * (settings.incomeTaxPercent / 100);
    const netProfit = profitBeforeTax - incomeTax;
    const bonus = netProfit > 0 ? netProfit * bonusPercent : 0;

    lastCalculation = {
      companyName,
      revenue,
      purchase,
      logistics,
      bonusPercent: (bonusPercent * 100).toFixed(1).replace(/\.0$/, ''),
      vatPercent: settings.vatPercent,
      incomeTaxPercent: settings.incomeTaxPercent,
      margin,
      vat,
      incomeTax,
      netProfit,
      bonus
    };

    document.getElementById('resMargin').textContent = fmt(margin) + ' ₽';
    document.getElementById('resVAT').textContent = '- ' + fmt(vat) + ' ₽';
    document.getElementById('resTax').textContent = '- ' + fmt(incomeTax) + ' ₽';
    document.getElementById('resNetProfit').textContent = fmt(netProfit) + ' ₽';
    document.getElementById('resBonus').textContent = fmt(bonus) + ' ₽';

    document.getElementById('results').classList.remove('hidden');
    document.getElementById('btnExcel').disabled = false;
    document.getElementById('btnPdf').disabled = false;

    if (saveToHistory && bridge && bridge.historyAdd) {
      bridge.historyAdd(lastCalculation).then(renderHistory).catch(() => renderHistory(historyCache));
    }
  } catch (err) {
    console.error('calculate error:', err);
    toast('Ошибка расчёта: ' + err.message);
  }
}

function exportExcel() {
  if (!lastCalculation) return;
  if (bridge && bridge.exportExcel) {
    bridge.exportExcel(lastCalculation).then(r => toast((r && r.msg) || 'Excel'));
  }
}

function exportPdf() {
  if (!lastCalculation) return;
  if (bridge && bridge.exportPdf) {
    bridge.exportPdf(lastCalculation).then(r => toast((r && r.msg) || 'PDF'));
  }
}

// --- Расчёт 2 (Менеджер / Маржа) ---
function readInputs2() {
  const managerName = document.getElementById('managerName').value.trim() || 'Без названия';
  const marginEl = document.getElementById('margin2');
  const margin = parseFloat(marginEl.value) || 0;
  const bonusPercent = parseFloat(document.getElementById('bonusPercent2').value) / 100;
  showFieldError(marginEl, false);
  return { managerName, margin, bonusPercent };
}

function calculate2(saveToHistory) {
  try {
    const { managerName, margin, bonusPercent } = readInputs2();
    const settings = readSettingsInputs2();

    const vat = margin * (settings.vatPercent / 100);
    const profitBeforeTax = margin - vat;
    const incomeTax = profitBeforeTax * (settings.incomeTaxPercent / 100);
    const netProfit = profitBeforeTax - incomeTax;
    const bonus = netProfit > 0 ? netProfit * bonusPercent : 0;

    lastCalculation = {
      type: 'margin',
      managerName,
      margin,
      bonusPercent: (bonusPercent * 100).toFixed(1).replace(/\.0$/, ''),
      vatPercent: settings.vatPercent,
      incomeTaxPercent: settings.incomeTaxPercent,
      vat,
      incomeTax,
      netProfit,
      bonus
    };

    document.getElementById('resVAT2').textContent = '- ' + fmt(vat) + ' ₽';
    document.getElementById('resTax2').textContent = '- ' + fmt(incomeTax) + ' ₽';
    document.getElementById('resNetProfit2').textContent = fmt(netProfit) + ' ₽';
    document.getElementById('resBonus2').textContent = fmt(bonus) + ' ₽';

    document.getElementById('results2').classList.remove('hidden');
    document.getElementById('btnExcel2').disabled = false;
    document.getElementById('btnPdf2').disabled = false;

    if (saveToHistory && bridge && bridge.historyAdd) {
      bridge.historyAdd(lastCalculation).then(renderHistory).catch(() => renderHistory(historyCache));
    }
  } catch (err) {
    console.error('calculate2 error:', err);
    toast('Ошибка расчёта: ' + err.message);
  }
}

function exportExcel2() {
  if (!lastCalculation) return;
  if (bridge && bridge.exportExcel) {
    bridge.exportExcel(lastCalculation).then(r => toast((r && r.msg) || 'Excel'));
  }
}

function exportPdf2() {
  if (!lastCalculation) return;
  if (bridge && bridge.exportPdf) {
    bridge.exportPdf(lastCalculation).then(r => toast((r && r.msg) || 'PDF'));
  }
}

// --- История: рендерим ТОЛЬКО через textContent/DOM, без innerHTML (защита от XSS) ---
function renderHistory(list) {
  historyCache = list || [];
  const wrap = document.getElementById('histList');
  const countEl = document.getElementById('histCount');
  const clearBtn = document.getElementById('btnClear');
  if (!wrap) return;
  wrap.textContent = '';

  if (historyCache.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Пока нет сохранённых расчётов';
    wrap.appendChild(empty);
    if (countEl) countEl.textContent = '0 зап.';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  if (countEl) countEl.textContent = historyCache.length + ' зап.';
  if (clearBtn) clearBtn.style.display = 'inline-block';

  historyCache.forEach((e, idx) => {
    const item = document.createElement('div');
    item.className = 'hitem';

    const main = document.createElement('div');
    main.className = 'main';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = e.type === 'margin'
      ? (e.managerName || 'Без названия')
      : (e.companyName || 'Без названия');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const d = new Date(e.createdAt);
    const dateStr = d.toLocaleDateString('ru-RU') + ' ' +
      d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const source = e.type === 'margin'
      ? 'маржа ' + fmtInt(e.margin) + ' ₽'
      : 'выручка ' + fmtInt(e.revenue) + ' ₽';
    const label = e.type === 'margin' ? ' · Расчёт 2' : ' · Расчёт 1';
    const rates = ' · НДС ' + (e.vatPercent ?? 20) + '% · НП ' + (e.incomeTaxPercent ?? 20) + '%';
    meta.textContent = dateStr + ' · ' + source + ' · бонус ' + e.bonusPercent + '%' + rates + label;
    main.appendChild(name);
    main.appendChild(meta);

    const bonus = document.createElement('div');
    bonus.className = 'bonus';
    bonus.textContent = fmt(e.bonus) + ' ₽';

    const del = document.createElement('button');
    del.className = 'del';
    del.title = 'Удалить';
    del.textContent = '×';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      bridge.historyRemove(e.id).then(renderHistory).catch(() => { });
    });

    item.addEventListener('click', () => applyHistory(historyCache[idx]));
    item.appendChild(main);
    item.appendChild(bonus);
    item.appendChild(del);
    wrap.appendChild(item);
  });
}

function applyHistory(e) {
  const bp = parseFloat(e.bonusPercent) || 30;
  if (e.type === 'margin') {
    switchTab(2);
    document.getElementById('managerName').value = e.managerName || '';
    document.getElementById('margin2').value = e.margin;
    document.getElementById('bonusPercent2').value = bp;
    updatePercentLabel2(bp);
    calculate2(false);
  } else {
    switchTab(1);
    document.getElementById('companyName').value = e.companyName;
    document.getElementById('revenue').value = e.revenue;
    document.getElementById('purchase').value = e.purchase;
    document.getElementById('logistics').value = e.logistics;
    document.getElementById('bonusPercent').value = bp;
    updatePercentLabel(bp);
    calculate(false);
  }
  const active = document.querySelector('.calc-panel.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('Расчёт загружен из истории');
}

function clearHistory() {
  if (bridge && bridge.historyClear) {
    bridge.historyClear().then(renderHistory).catch(() => { });
  }
  toast('История очищена');
}

// --- Переключение вкладок ---
function switchTab(n) {
  const panel1 = document.getElementById('panel1');
  const panel2 = document.getElementById('panel2');
  const tab1 = document.getElementById('tab1');
  const tab2 = document.getElementById('tab2');
  if (n === 1) {
    panel1.classList.add('active');
    panel2.classList.remove('active');
    tab1.classList.add('active');
    tab2.classList.remove('active');
  } else {
    panel1.classList.remove('active');
    panel2.classList.add('active');
    tab1.classList.remove('active');
    tab2.classList.add('active');
  }
}

// --- init ---
function init() {
  // Логотип: если файл не найден — скрываем
  const logo = document.querySelector('.masthead .logo img');
  if (logo) {
    logo.addEventListener('error', () => { logo.style.display = 'none'; }, { once: true });
  }

  slider = document.getElementById('bonusPercent');
  updatePercentLabel(slider ? slider.value : 30);
  if (slider) slider.addEventListener('input', () => updatePercentLabel(slider.value));

  slider2 = document.getElementById('bonusPercent2');
  updatePercentLabel2(slider2 ? slider2.value : 30);
  if (slider2) slider2.addEventListener('input', () => updatePercentLabel2(slider2.value));

  // Настройки: загрузка из localStorage
  applySettingsToUI(loadSettings());

  // Синхронизация ставок между панелями + сохранение при изменении
  const settingsFields = [
    { main: 'vatPercent', second: 'vatPercent2' },
    { main: 'incomeTaxPercent', second: 'incomeTaxPercent2' }
  ];

  settingsFields.forEach(({ main, second }) => {
    const elMain = document.getElementById(main);
    const elSecond = document.getElementById(second);
    if (!elMain || !elSecond) return;
    const handler = () => {
      elSecond.value = elMain.value;
      saveSettings(readSettingsInputs());
    };
    elMain.addEventListener('input', handler);
    elMain.addEventListener('blur', handler);
    elSecond.addEventListener('input', () => {
      elMain.value = elSecond.value;
      saveSettings(readSettingsInputs2());
    });
    elSecond.addEventListener('blur', () => {
      elMain.value = elSecond.value;
      saveSettings(readSettingsInputs2());
    });
  });

  // Кнопки и вкладки
  const tab1 = document.getElementById('tab1');
  const tab2 = document.getElementById('tab2');
  const btnCalc = document.getElementById('btnCalc');
  const btnExcel = document.getElementById('btnExcel');
  const btnPdf = document.getElementById('btnPdf');
  const btnCalc2 = document.getElementById('btnCalc2');
  const btnExcel2 = document.getElementById('btnExcel2');
  const btnPdf2 = document.getElementById('btnPdf2');
  const btnClear = document.getElementById('btnClear');

  if (tab1) tab1.addEventListener('click', () => switchTab(1));
  if (tab2) tab2.addEventListener('click', () => switchTab(2));
  if (btnCalc) btnCalc.addEventListener('click', () => calculate(true));
  if (btnExcel) btnExcel.addEventListener('click', exportExcel);
  if (btnPdf) btnPdf.addEventListener('click', exportPdf);
  if (btnCalc2) btnCalc2.addEventListener('click', () => calculate2(true));
  if (btnExcel2) btnExcel2.addEventListener('click', exportExcel2);
  if (btnPdf2) btnPdf2.addEventListener('click', exportPdf2);
  if (btnClear) btnClear.addEventListener('click', clearHistory);

  // Enter в полях = рассчитать
  ['revenue', 'purchase', 'logistics', 'companyName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') calculate(true);
    });
  });

  ['managerName', 'margin2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') calculate2(true);
    });
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      const panel2Active = document.getElementById('panel2') && document.getElementById('panel2').classList.contains('active');
      if (panel2Active) {
        calculate2(true);
      } else {
        calculate(true);
      }
    }
  });

  // Загрузка настроек из main-процесса при старте
  if (bridge && bridge.settingsLoad) {
    bridge.settingsLoad().then(s => {
      if (s && s.vatPercent !== undefined) {
        applySettingsToUI(s);
      }
    }).catch(() => { });
  }

  if (bridge && bridge.historyLoad) {
    bridge.historyLoad().then(renderHistory).catch(() => renderHistory([]));
  } else {
    renderHistory([]);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}