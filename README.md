# Калькулятор премии (BonusCalc)

Electron-приложение для расчёта премии и рентабельности сделки.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

## 📋 Возможности

- **Два режима расчёта:**
  - Расчёт 1 — по выручке/закупке/логистике
  - Расчёт 2 — по марже (для менеджеров)
- **Настраиваемые ставки** — НДС и налог на прибыль (значения сохраняются между сеансами)
- **История расчётов** — автоматическое сохранение, дедупликация, загрузка из истории
- **Экспорт** — выгрузка отчёта в Excel (`.xlsx`) и PDF
- **Собственный логотип** — автоматическая генерация иконок и логотипа из файла `icon.png`
- **Безопасность** — `contextIsolation` + CSP, без `nodeIntegration`

## 🚀 Установка

### Готовая сборка

Скачайте последний релиз: https://github.com/IgorLamakin/BonusCalcApp/releases

- **BonusCalc-Setup-x.x.x-x64.exe** — установщик (создаёт ярлык, доступна деинсталляция)
- **BonusCalc-Portable-x.x.x-x64.exe** — портативная версия (работает без установки)

> ⚠️ Приложение не подписано цифровой подписью.
> При первом запуске Windows может показать SmartScreen: **«Подробнее» → «Выполнить в любом случае»**.

**Требования:** Windows 10/11 (x64), не требует Node.js.

### Из исходников

```bash
# 1. Клонировать репозиторий
git clone https://github.com/IgorLamakin/BonusCalcApp.git
cd BonusCalcApp

# 2. Установить зависимости (нужен Node.js 18+)
npm install

# 3. Запустить в режиме разработки
npm start
```

## 🔨 Сборка дистрибутива

```bash
# Установщик (NSIS)
npm run dist

# Портативная версия
npm run dist-portable
```

## 🎨 Генерация иконок

Приложение использует ваш логотип из файла `icon.png` (в корне проекта).

```bash
# Сгенерировать иконки из icon.png (build/ и assets/)
npm run icon

# Использовать дефолтную иконку с символом %
npm run icon-default
```

Скрипт:
- вырезает логотип из изображения (авто-обрезка полей);
- создаёт квадрат 512×512 со скруглёнными углами;
- генерирует многоразмерную Windows-иконку `.ico`.

## 📁 Структура проекта

```
├── index.html        # Интерфейс (HTML/CSS)
├── renderer.js        # Логика интерфейса (CSP-safe, внешний файл)
├── main.js            # Главный процесс Electron
├── preload.js         # Безопасный мост IPC (contextBridge)
├── process-logo.js    # Генерация иконок из icon.png
├── make-icon.js       # Дефолтная иконка с %
├── assets/            # Логотип и иконки приложения (в asar)
├── build/             # Ресурсы для electron-builder
├── font.ttf           # Кириллический шрифт для PDF
└── icon.png           # Ваш исходный логотип
```

## 📦 Данные приложения

- История расчётов и настройки хранятся в `%APPDATA%/raschet-rentabelnosti/`
- Для переноса между компьютерами скопируйте файл `history.json` и `settings.json`

## 📄 Лицензия

[MIT](LICENSE)