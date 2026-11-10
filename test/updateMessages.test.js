'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { describeUpdateStatus, RELEASES_URL } = require('../src/main/updateMessages');

test('обновление: проверка показывает баннер без кнопки', () => {
  const view = describeUpdateStatus({ status: 'checking' });
  assert.equal(view.visible, true);
  assert.equal(view.action, null);
  assert.match(view.text, /Проверяем/);
});

test('обновление: доступна новая версия — кнопка «Скачать»', () => {
  const view = describeUpdateStatus({ status: 'available', version: '2.2.0' });
  assert.equal(view.visible, true);
  assert.equal(view.action, 'download');
  assert.equal(view.actionLabel, 'Скачать');
  assert.match(view.text, /v2\.2\.0/);
});

test('обновление: прогресс загрузки показывает проценты', () => {
  const view = describeUpdateStatus({ status: 'downloading', version: '2.2.0', percent: 42 });
  assert.equal(view.visible, true);
  assert.equal(view.action, null);
  assert.match(view.text, /42 %/);
});

test('обновление: готово к установке — кнопка «Перезапустить»', () => {
  const view = describeUpdateStatus({ status: 'ready', version: '2.2.0' });
  assert.equal(view.action, 'install');
  assert.equal(view.actionLabel, 'Перезапустить');
  assert.match(view.text, /v2\.2\.0/);
});

test('обновление: актуальная версия — баннера нет, есть сообщение', () => {
  const view = describeUpdateStatus({ status: 'current' });
  assert.equal(view.visible, false);
  assert.match(view.toast, /последняя версия/);
});

test('обновление: ошибка сети не ломает интерфейс', () => {
  const view = describeUpdateStatus({ status: 'error' });
  assert.equal(view.visible, false);
  assert.match(view.toast, /Не удалось проверить/);
});

test('обновление: портативная версия отправляет на страницу релизов', () => {
  const view = describeUpdateStatus({ status: 'disabled', reason: 'portable' });
  assert.equal(view.visible, false);
  assert.equal(view.openUrl, RELEASES_URL);
  assert.match(view.toast, /вручную/);
});

test('обновление: в режиме разработки проверка недоступна', () => {
  const view = describeUpdateStatus({ status: 'disabled', reason: 'dev' });
  assert.equal(view.visible, false);
  assert.match(view.toast, /установленной версии/);
});

test('обновление: неизвестное состояние не показывает баннер', () => {
  const view = describeUpdateStatus({ status: 'idle' });
  assert.equal(view.visible, false);
  assert.equal(view.toast, null);
});
