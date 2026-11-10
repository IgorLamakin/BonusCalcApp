'use strict';

/**
 * Интерфейс калькулятора.
 *
 * Формулы берутся из общего модуля (window.Calc), работа с системой — только
 * через мост window.api (preload). Обе панели используют один и тот же код,
 * поэтому расчёт 1 и расчёт 2 не могут «разъехаться».
 */

(function () {
  const Calc = window.Calc;
  const bridge = window.api;

  const byId = (id) => document.getElementById(id);

  const state = {
    settings: {
      vatPercent: Calc.DEFAULT_SETTINGS.vatPercent,
      incomeTaxPercent: Calc.DEFAULT_SETTINGS.incomeTaxPercent,
      bonusPercent: Calc.DEFAULT_SETTINGS.bonusPercent
    },
    history: [],
    panels: {},
    active: 'deal'
  };

  const PANEL_CONFIG = {
    deal: {
      kind: 'deal',
      tabId: 'tab1',
      panelId: 'panel1',
      formId: 'dealForm',
      nameId: 'companyName',
      nameKey: 'companyName',
      amountFields: [
        { id: 'revenue', key: 'revenue' },
        { id: 'purchase', key: 'purchase' },
        { id: 'logistics', key: 'logistics' }
      ],
      bonusRangeId: 'bonusPercent',
      bonusInputId: 'bonusPercentInput',
      bonusErrorId: 'bonusPercentError',
      vatInputId: 'vatPercent',
      vatErrorId: 'vatPercentError',
      taxInputId: 'incomeTaxPercent',
      taxErrorId: 'incomeTaxPercentError',
      btnCalcId: 'btnCalc',
      btnExcelId: 'btnExcel',
      btnPdfId: 'btnPdf',
      resultsId: 'results',
      out: {
        margin: 'resMargin',
        vat: 'resVat',
        tax: 'resTax',
        profit: 'resProfit',
        bonus: 'resBonus'
      },
      rows: { margin: 'rowMargin', profit: 'rowProfit' }
    },
    margin: {
      kind: 'margin',
      tabId: 'tab2',
      panelId: 'panel2',
      formId: 'marginForm',
      nameId: 'managerName',
      nameKey: 'managerName',
      amountFields: [{ id: 'margin2', key: 'margin' }],
      bonusRangeId: 'bonusPercent2',
      bonusInputId: 'bonusPercent2Input',
      bonusErrorId: 'bonusPercent2Error',
      vatInputId: 'vatPercent2',
      vatErrorId: 'vatPercent2Error',
      taxInputId: 'incomeTaxPercent2',
      taxErrorId: 'incomeTaxPercent2Error',
      btnCalcId: 'btnCalc2',
      btnExcelId: 'btnExcel2',
      btnPdfId: 'btnPdf2',
      resultsId: 'results2',
      out: { vat: 'resVat2', tax: 'resTax2', profit: 'resProfit2', bonus: 'resBonus2' },
      rows: { profit: 'rowProfit2' }
    }
  };

  // --- Уведомления -----------------------------------------------------------

  let toastTimer = null;

  function toast(message, kind) {
    const node = byId('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', kind === 'error');
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), kind === 'error' ? 4500 : 2600);
  }

  // --- Общие помощники -------------------------------------------------------

  function paintSlider(range) {
    if (!range) return;
    const min = Number(range.min) || 0;
    const max = Number(range.max) || 100;
    const value = Number(range.value) || 0;
    const percent = ((value - min) / (max - min)) * 100;
    range.style.background = `linear-gradient(90deg, #4f8cff 0%, #4f8cff ${percent}%, rgba(148, 163, 184, .25) ${percent}%)`;
  }

  function percentInputText(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return String(Calc.round2(n)).replace('.', ',');
  }

  function setMoney(id, value, rowId, options) {
    const node = byId(id);
    if (!node) return;
    const opts = options || {};
    const negative = value < 0;
    let text = Calc.formatMoney(Math.abs(value));
    if (opts.deduction) text = negative ? `+ ${text}` : `− ${text}`;
    else if (negative) text = `− ${text}`;
    node.textContent = text;
    if (rowId) {
      const row = byId(rowId);
      if (row) row.classList.toggle('negative', negative);
    }
  }

  // --- Панель расчёта --------------------------------------------------------

  function createPanel(config) {
    const panel = {
      config,
      kind: config.kind,
      form: byId(config.formId),
      tab: byId(config.tabId),
      panelEl: byId(config.panelId),
      nameInput: byId(config.nameId),
      bonusRange: byId(config.bonusRangeId),
      bonusInput: byId(config.bonusInputId),
      vatInput: byId(config.vatInputId),
      taxInput: byId(config.taxInputId),
      btnCalc: byId(config.btnCalcId),
      btnExcel: byId(config.btnExcelId),
      btnPdf: byId(config.btnPdfId),
      results: byId(config.resultsId),
      snapshot: null,
      dirty: true
    };

    panel.amounts = config.amountFields.map((field) => {
      const id = typeof field === 'string' ? field : field.id;
      const key = typeof field === 'string' ? field : field.key || field.id;
      return { id, key, input: byId(id), error: byId(`${id}Error`) };
    });

    panel.setError = (input, errorNode, message) => {
      if (!input) return;
      if (message) {
        input.classList.add('field-invalid');
        input.setAttribute('aria-invalid', 'true');
        if (errorNode) errorNode.textContent = message;
      } else {
        input.classList.remove('field-invalid');
        input.removeAttribute('aria-invalid');
        if (errorNode) errorNode.textContent = '';
      }
    };

    panel.read = () => {
      const values = {};
      let firstInvalid = null;
      let firstMessage = '';

      for (const field of panel.amounts) {
        const parsed = Calc.parseAmount(field.input.value);
        panel.setError(field.input, field.error, parsed.ok ? '' : parsed.reason);
        if (!parsed.ok && !firstInvalid) {
          firstInvalid = field.input;
          firstMessage = parsed.reason;
        }
        values[field.key] = parsed.value;
      }

      const bonus = Calc.parsePercent(panel.bonusInput.value, state.settings.bonusPercent);
      panel.setError(panel.bonusInput, byId(config.bonusErrorId), bonus.ok ? '' : bonus.reason);
      if (!bonus.ok && !firstInvalid) {
        firstInvalid = panel.bonusInput;
        firstMessage = bonus.reason;
      }

      const vat = Calc.parsePercent(panel.vatInput.value, state.settings.vatPercent);
      panel.setError(panel.vatInput, byId(config.vatErrorId), vat.ok ? '' : vat.reason);
      if (!vat.ok && !firstInvalid) {
        firstInvalid = panel.vatInput;
        firstMessage = vat.reason;
      }

      const tax = Calc.parsePercent(panel.taxInput.value, state.settings.incomeTaxPercent);
      panel.setError(panel.taxInput, byId(config.taxErrorId), tax.ok ? '' : tax.reason);
      if (!tax.ok && !firstInvalid) {
        firstInvalid = panel.taxInput;
        firstMessage = tax.reason;
      }

      const raw = {
        type: config.kind,
        bonusPercent: bonus.value,
        vatPercent: vat.value,
        incomeTaxPercent: tax.value,
        ...values
      };
      raw[config.nameKey] = panel.nameInput.value;

      return {
        ok: !firstInvalid,
        message: firstMessage || 'Проверьте выделенные поля',
        firstInvalid,
        inputs: Calc.normalizeInputs(raw)
      };
    };

    panel.render = (result) => {
      const out = config.out;
      panel.results.classList.remove('hidden');
      panel.results.classList.remove('stale');

      if (out.margin) setMoney(out.margin, result.margin, config.rows.margin);
      setMoney(out.vat, result.vat, null, { deduction: true });
      setMoney(out.tax, result.incomeTax, null, { deduction: true });
      setMoney(out.profit, result.netProfit, config.rows.profit);
      setMoney(out.bonus, result.bonus);
    };

    panel.invalidate = () => {
      if (!panel.snapshot) return;
      panel.dirty = true;
      panel.results.classList.add('stale');
      panel.btnExcel.disabled = true;
      panel.btnPdf.disabled = true;
    };

    panel.calculate = async (options) => {
      const opts = options || {};
      const data = panel.read();
      if (!data.ok) {
        toast(data.message, 'error');
        if (data.firstInvalid) data.firstInvalid.focus();
        return null;
      }

      const result = Calc.compute(data.inputs);
      panel.render(result);
      panel.snapshot = { inputs: data.inputs, result };
      panel.dirty = false;
      panel.btnExcel.disabled = false;
      panel.btnPdf.disabled = false;

      if (opts.save !== false) await addToHistory(data.inputs);
      return result;
    };

    panel.setBonus = (value) => {
      const clamped = Calc.clamp(Number(value) || 0, 0, 100);
      panel.bonusInput.value = percentInputText(clamped);
      panel.bonusRange.value = String(Math.round(clamped));
      paintSlider(panel.bonusRange);
    };

    panel.load = (inputs) => {
      if (inputs.type === 'margin') {
        panel.amounts[0].input.value = String(inputs.margin);
        panel.nameInput.value = inputs.managerName;
      } else {
        for (const field of panel.amounts) {
          field.input.value = String(inputs[field.key]);
        }
        panel.nameInput.value = inputs.companyName;
      }
      panel.setBonus(inputs.bonusPercent);
      panel.dirty = true;
      panel.invalidate();
    };

    return panel;
  }

  // --- Настройки -------------------------------------------------------------

  let settingsTimer = null;

  function scheduleSettingsSave() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      const deal = state.panels.deal;
      const active = state.panels[state.active] || deal;
      const vat = Calc.parsePercent(deal.vatInput.value, 20);
      const tax = Calc.parsePercent(deal.taxInput.value, 20);
      const bonus = Calc.parsePercent(active.bonusInput.value, 30);
      const patch = {
        vatPercent: vat.value,
        incomeTaxPercent: tax.value,
        bonusPercent: bonus.value
      };
      state.settings = { ...state.settings, ...patch };
      bridge.settingsSave(patch).catch(() => {});
    }, 400);
  }

  function applyRates(vatValue, taxValue, sourcePanel) {
    for (const panel of Object.values(state.panels)) {
      if (panel === sourcePanel) continue;
      panel.vatInput.value = percentInputText(vatValue);
      panel.taxInput.value = percentInputText(taxValue);
    }
  }

  function applySettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    state.settings = {
      ...state.settings,
      vatPercent: Number(settings.vatPercent) || 0,
      incomeTaxPercent: Number(settings.incomeTaxPercent) || 0,
      bonusPercent: Number(settings.bonusPercent) || 0
    };

    for (const panel of Object.values(state.panels)) {
      panel.vatInput.value = percentInputText(state.settings.vatPercent);
      panel.taxInput.value = percentInputText(state.settings.incomeTaxPercent);
      panel.setBonus(state.settings.bonusPercent);
    }
  }

  // --- История ---------------------------------------------------------------

  function formatDateTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return (
      date.toLocaleDateString('ru-RU') +
      ' ' +
      date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    );
  }

  function renderHistory(items) {
    state.history = Array.isArray(items) ? items : [];
    const list = byId('histList');
    const count = byId('histCount');
    const clearButton = byId('btnClearHistory');
    const exportButton = byId('btnExportCsv');
    if (!list) return;

    list.textContent = '';

    if (count) {
      count.textContent = state.history.length === 0 ? '0 зап.' : `${state.history.length} зап.`;
    }
    if (clearButton) clearButton.hidden = state.history.length === 0;
    if (exportButton) exportButton.hidden = state.history.length === 0;

    if (state.history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Пока нет сохранённых расчётов';
      list.appendChild(empty);
      return;
    }

    for (const item of state.history) {
      const inputs = item.inputs;
      const result = item.result;
      const isMargin = item.type === 'margin';

      const card = document.createElement('div');
      card.className = 'hitem';
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.setAttribute(
        'aria-label',
        `Загрузить расчёт: ${isMargin ? inputs.managerName : inputs.companyName}`
      );

      const main = document.createElement('div');
      main.className = 'main';

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = isMargin ? inputs.managerName : inputs.companyName;

      const meta = document.createElement('div');
      meta.className = 'meta';
      const source = isMargin
        ? `маржа ${Calc.formatInt(inputs.margin)} ₽`
        : `выручка ${Calc.formatInt(inputs.revenue)} ₽`;
      meta.textContent =
        `${formatDateTime(item.createdAt)} · ${source} · премия ${Calc.formatPercent(inputs.bonusPercent)}` +
        ` · НДС ${Calc.formatPercent(inputs.vatPercent)}` +
        ` · налог ${Calc.formatPercent(inputs.incomeTaxPercent)}` +
        (isMargin ? ' · Расчёт 2' : ' · Расчёт 1');

      const bonus = document.createElement('div');
      bonus.className = 'bonus';
      bonus.textContent = Calc.formatMoney(result.bonus);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'del';
      remove.title = 'Удалить запись';
      remove.setAttribute('aria-label', 'Удалить запись из истории');
      remove.textContent = '×';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        bridge
          .historyRemove(item.id)
          .then((response) => {
            renderHistory(response.items);
            toast('Запись удалена');
          })
          .catch(() => toast('Не удалось удалить запись', 'error'));
      });

      main.appendChild(name);
      main.appendChild(meta);
      card.appendChild(main);
      card.appendChild(bonus);
      card.appendChild(remove);

      const load = () => applyRecord(item);
      card.addEventListener('click', load);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          load();
        }
      });

      list.appendChild(card);
    }
  }

  async function addToHistory(inputs) {
    try {
      const response = await bridge.historyAdd(inputs);
      renderHistory(response.items);
    } catch {
      toast('Расчёт выполнен, но в историю не попал', 'error');
    }
  }

  function applyRecord(record) {
    const panel = state.panels[record.type];
    if (!panel) return;
    const inputs = record.inputs;

    switchTab(record.type);
    panel.load(inputs);

    for (const other of Object.values(state.panels)) {
      other.vatInput.value = percentInputText(inputs.vatPercent);
      other.taxInput.value = percentInputText(inputs.incomeTaxPercent);
    }
    state.settings = {
      ...state.settings,
      vatPercent: inputs.vatPercent,
      incomeTaxPercent: inputs.incomeTaxPercent,
      bonusPercent: inputs.bonusPercent
    };
    scheduleSettingsSave();

    panel.calculate({ save: false });
    if (panel.form && panel.form.scrollIntoView) {
      panel.form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    toast(
      `Расчёт загружен · НДС ${Calc.formatPercent(inputs.vatPercent)}, налог ${Calc.formatPercent(inputs.incomeTaxPercent)}`
    );
  }

  // --- Вкладки ---------------------------------------------------------------

  function switchTab(kind) {
    state.active = kind;
    for (const [name, panel] of Object.entries(state.panels)) {
      const isActive = name === kind;
      panel.panelEl.classList.toggle('active', isActive);
      panel.tab.classList.toggle('active', isActive);
      panel.tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  }

  // --- Экспорт ---------------------------------------------------------------

  function setBusy(panel, busy) {
    panel.btnCalc.disabled = busy;
    panel.btnExcel.disabled = busy || !panel.snapshot || panel.dirty;
    panel.btnPdf.disabled = busy || !panel.snapshot || panel.dirty;
  }

  async function exportReport(panel, format) {
    if (!panel.snapshot || panel.dirty) {
      toast('Сначала нажмите «Рассчитать»', 'error');
      return;
    }

    setBusy(panel, true);
    try {
      const call = format === 'pdf' ? bridge.exportPdf : bridge.exportExcel;
      const response = await call(panel.snapshot.inputs);
      if (response && response.ok) toast(response.msg);
      else if (response && response.cancelled) toast('Сохранение отменено');
      else toast((response && response.msg) || 'Не удалось сохранить файл', 'error');
    } catch (err) {
      toast(`Ошибка экспорта: ${err.message}`, 'error');
    } finally {
      setBusy(panel, false);
    }
  }

  // --- Инициализация ---------------------------------------------------------

  function bindPanelEvents(panel) {
    const config = panel.config;

    panel.form.addEventListener('submit', (event) => {
      event.preventDefault();
      panel.calculate();
    });

    panel.form.addEventListener('input', (event) => {
      const target = event.target;
      if (!target || !target.id) return;
      if (target.id === config.bonusRangeId) return;
      panel.invalidate();
    });

    panel.btnExcel.addEventListener('click', () => exportReport(panel, 'xlsx'));
    panel.btnPdf.addEventListener('click', () => exportReport(panel, 'pdf'));

    panel.bonusRange.addEventListener('input', () => {
      panel.bonusInput.value = percentInputText(panel.bonusRange.value);
      paintSlider(panel.bonusRange);
      panel.invalidate();
      scheduleSettingsSave();
    });

    panel.bonusInput.addEventListener('input', () => {
      const parsed = Calc.parsePercent(panel.bonusInput.value, 30);
      if (parsed.ok) {
        panel.bonusRange.value = String(Math.round(parsed.value));
        paintSlider(panel.bonusRange);
      }
      panel.invalidate();
    });

    panel.bonusInput.addEventListener('blur', () => {
      const parsed = Calc.parsePercent(panel.bonusInput.value, 30);
      panel.setError(panel.bonusInput, byId(config.bonusErrorId), parsed.ok ? '' : parsed.reason);
      if (parsed.ok) panel.setBonus(parsed.value);
    });

    panel.vatInput.addEventListener('input', () => {
      applyRates(panel.vatInput.value, panel.taxInput.value, panel);
      panel.invalidate();
      scheduleSettingsSave();
    });

    panel.taxInput.addEventListener('input', () => {
      applyRates(panel.vatInput.value, panel.taxInput.value, panel);
      panel.invalidate();
      scheduleSettingsSave();
    });

    panel.form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.target.blur();
      }
    });
  }

  function bindGlobalEvents() {
    byId('tab1').addEventListener('click', () => switchTab('deal'));
    byId('tab2').addEventListener('click', () => switchTab('margin'));

    byId('btnClearHistory').addEventListener('click', async () => {
      try {
        const response = await bridge.historyClear();
        renderHistory(response.items);
        toast(
          response.cancelled ? 'Очистка отменена' : 'История очищена',
          response.cancelled ? undefined : 'ok'
        );
      } catch {
        toast('Не удалось очистить историю', 'error');
      }
    });

    byId('btnExportCsv').addEventListener('click', async () => {
      try {
        const response = await bridge.historyExportCsv();
        if (response && response.ok) toast(response.msg);
        else if (response && response.cancelled) toast('Сохранение отменено');
        else toast((response && response.msg) || 'Не удалось выгрузить историю', 'error');
      } catch {
        toast('Не удалось выгрузить историю', 'error');
      }
    });

    byId('btnOpenData').addEventListener('click', async () => {
      try {
        const response = await bridge.openDataFolder();
        if (!response || !response.ok) {
          toast((response && response.msg) || 'Не удалось открыть папку', 'error');
        }
      } catch {
        toast('Не удалось открыть папку', 'error');
      }
    });

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        const panel = state.panels[state.active];
        if (panel) panel.calculate();
      }
    });

    const logo = byId('logoImg');
    if (logo) {
      logo.addEventListener('error', () => {
        logo.hidden = true;
      });
    }
  }

  async function init() {
    state.panels.deal = createPanel(PANEL_CONFIG.deal);
    state.panels.margin = createPanel(PANEL_CONFIG.margin);

    for (const panel of Object.values(state.panels)) bindPanelEvents(panel);
    bindGlobalEvents();
    switchTab('deal');

    if (!bridge) {
      toast('Нет связи с системной частью приложения — экспорт недоступен', 'error');
      return;
    }

    try {
      const info = await bridge.appInfo();
      if (info) {
        const versionLabel = byId('versionLabel');
        const footerVersion = byId('footerVersion');
        if (versionLabel) versionLabel.textContent = `v${info.version}`;
        if (footerVersion) {
          footerVersion.textContent = `v${info.version} · Electron ${info.electron}`;
        }
      }
    } catch {
      /* версия не критична */
    }

    try {
      const loaded = await bridge.settingsLoad();
      if (loaded && loaded.settings) applySettings(loaded.settings);
      if (loaded && loaded.recovered) {
        toast(
          'Файл настроек был повреждён — восстановлены значения по умолчанию, ставки стоит проверить',
          'error'
        );
      }
    } catch {
      toast('Не удалось загрузить настройки — используются 20 % / 20 %', 'error');
    }

    try {
      const history = await bridge.historyLoad();
      renderHistory(history.items);
      if (history.recovered) {
        toast('Файл истории был повреждён — данные восстановлены из резервной копии', 'error');
      }
    } catch {
      renderHistory([]);
      toast('Не удалось загрузить историю расчётов', 'error');
    }

    for (const panel of Object.values(state.panels)) paintSlider(panel.bonusRange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
