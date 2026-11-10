'use strict';

/**
 * Тексты и кнопки для баннера автообновления.
 * Чистые функции — используются главным процессом и покрыты тестами.
 */

const RELEASES_URL = 'https://github.com/IgorLamakin/BonusCalcApp/releases/latest';

function describeUpdateStatus(state) {
  const current = state && typeof state === 'object' ? state : { status: 'idle' };
  const version = current.version ? `v${current.version}` : '';

  switch (current.status) {
    case 'checking':
      return { visible: true, text: 'Проверяем обновления…', action: null };

    case 'available':
      return {
        visible: true,
        text: `Доступно обновление ${version}`.trim(),
        action: 'download',
        actionLabel: 'Скачать'
      };

    case 'downloading': {
      const percent = Number.isFinite(current.percent) ? ` — ${current.percent} %` : '';
      return {
        visible: true,
        text: `Загружаем обновление ${version}${percent}`.trim(),
        action: null
      };
    }

    case 'ready':
      return {
        visible: true,
        text: `Обновление ${version} готово к установке`.trim(),
        action: 'install',
        actionLabel: 'Перезапустить'
      };

    case 'current':
      return {
        visible: false,
        toast: 'Обновлений нет — установлена последняя версия'
      };

    case 'error':
      return {
        visible: false,
        toast: 'Не удалось проверить обновления. Проверьте подключение к интернету.'
      };

    case 'disabled': {
      if (current.reason === 'portable') {
        return {
          visible: false,
          toast: 'Портативная версия обновляется вручную: откроется страница с новой версией',
          openUrl: RELEASES_URL
        };
      }
      if (current.reason === 'dev') {
        return {
          visible: false,
          toast: 'Проверка обновлений доступна только в установленной версии'
        };
      }
      return { visible: false, toast: 'Обновления недоступны' };
    }

    default:
      return { visible: false, toast: null };
  }
}

module.exports = { describeUpdateStatus, RELEASES_URL };
