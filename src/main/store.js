'use strict';

/**
 * Небольшое хранилище JSON-файлов с атомарной записью.
 *
 * Зачем: обычный writeFileSync при сбое питания/крэше оставляет обрезанный
 * JSON, и данные «исчезают». Здесь запись идёт в *.tmp, затем подменяет
 * основной файл, а предыдущая версия остаётся в *.bak. При чтении, если
 * основной файл битый, значения берутся из резервной копии.
 */

const fs = require('fs');
const path = require('path');

class JsonStore {
  /**
   * @param {string} file путь к JSON-файлу
   * @param {{defaults: any, migrate?: (raw: any) => any, normalize?: (data: any) => any}} options
   */
  constructor(file, options = {}) {
    this.file = file;
    this.tmpFile = `${file}.tmp`;
    this.backupFile = `${file}.bak`;
    this.defaults = options.defaults;
    this.migrate = typeof options.migrate === 'function' ? options.migrate : (raw) => raw;
    this.normalize = typeof options.normalize === 'function' ? options.normalize : (data) => data;
    this.data = null;
    this.recovered = false;
  }

  /** Читает файл с диска; при ошибке пробует резервную копию. */
  load() {
    this.recovered = false;
    const candidates = [this.file, this.backupFile];

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        this.data = this.#finalize(raw);
        if (candidate === this.backupFile) {
          this.recovered = true;
          this.#write(this.data);
        }
        return this.data;
      } catch (err) {
        console.error(`[store] не удалось прочитать ${path.basename(candidate)}:`, err.message);
      }
    }

    // Файлов нет или оба повреждены — работаем со значениями по умолчанию.
    this.data = this.#finalize(this.#clone(this.defaults));
    if (fs.existsSync(this.file)) this.recovered = true;
    return this.data;
  }

  get() {
    if (this.data === null) this.load();
    return this.data;
  }

  /** Сохраняет переданные данные и делает их текущими. */
  set(data) {
    const prepared = this.#finalize(data);
    this.#write(prepared);
    this.data = prepared;
    return prepared;
  }

  /** Изменяет данные функцией и сохраняет результат. */
  update(mutator) {
    const current = this.get();
    const next = mutator(this.#clone(current));
    return this.set(next === undefined ? current : next);
  }

  #clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  #finalize(raw) {
    const migrated = this.migrate(raw === undefined ? this.#clone(this.defaults) : raw);
    return this.normalize(migrated);
  }

  #write(data) {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.tmpFile, JSON.stringify(data, null, 2), 'utf8');

    if (fs.existsSync(this.file)) {
      try {
        fs.copyFileSync(this.file, this.backupFile);
      } catch (err) {
        console.error('[store] не удалось создать резервную копию:', err.message);
      }
    }

    fs.renameSync(this.tmpFile, this.file);
  }
}

module.exports = { JsonStore };
