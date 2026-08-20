# Changelog

Все заметные изменения этого проекта задокументированы в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [2.0.0] — 2026-08-20

### Добавлено
- Два режима расчёта: по выручке и по марже
- Настраиваемые ставки НДС и налога на прибыль (сохраняются в localStorage и settings.json)
- История расчётов с дедупликацией и ограничением 100 записей
- Экспорт отчёта в Excel (exceljs) и PDF (pdfkit) с поддержкой обоих режимов
- Кириллический шрифт (font.ttf) для корректного PDF-экспорта
- Генерация иконок из пользовательского логотипа (process-logo.js):
  - поддержка PNG 8/16-bit, color types 0/2/3/4/6
  - авто-кадрирование по содержимому (для A4-листов)
  - скруглённые углы, боксовый ресайз
- Дефолтная иконка с символом % (make-icon.js)
- Портативная сборка (npm run dist-portable)
- GitHub Release с установщиком и портативной версией
- .gitignore для Electron-проекта
- LICENSE (MIT)
- README.md и CHANGELOG.md

### Исправлено
- Экспорт Excel/PDF для Расчёта 2 (margin-тип) — ранее обращался к несуществующим полям companyName/revenue
- НДС в Расчёте 2 — захардкоженный 22% заменён на настраиваемую ставку
- CSP блокировал весь inline-скрипт — JS вынесен в renderer.js
- Конфликт имён `const api` с `contextBridge.exposeInMainWorld('api')` — используется псевдоним `bridge`
- `sandbox: true` блокировал contextBridge — отключён
- `classList.toggle(className, force)` в Electron — заменён на явные add/remove
- Логотип не попадал в asar — перенесён из build/ в assets/
- Обработчики кнопок экспорта вызывались сразу (`exportExcel()`) вместо передачи по клику
- Title страницы не совпадал с заголовком в шапке

### Безопасность
- contextIsolation: true, nodeIntegration: false
- Content Security Policy (script-src 'self')
- Валидация IPC-данных (sanitizeCalc, toNum)
- Рендер истории через DOM API, без innerHTML (защита от XSS)
- Блокировка навигации и всплывающих окон

## [1.0.0] — первоначальная версия

- Базовый калькулятор с одним режимом расчёта
- Экспорт в Excel и PDF
- История расчётов
