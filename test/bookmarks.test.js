const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

class Element {
  constructor(tag, document) {
    this.tag = tag;
    this.document = document;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this._text = '';
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map(child => child.textContent).join('');
  }

  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this.children = children; this._text = ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  querySelectorAll(selector) {
    assert.equal(selector, '[role="tab"]');
    return this.children.filter(child => child.attributes.role === 'tab');
  }
  querySelector(selector) {
    if (!['.dialog-cancel', '[type="submit"]'].includes(selector)) throw new Error(`Unexpected selector: ${selector}`);
    const matches = child => selector === '.dialog-cancel' ? child.className === 'dialog-cancel' : child.type === 'submit';
    for (const child of this.children) {
      if (matches(child)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.document.activeElement = this; }
  click() { this.listeners.click(); }
}

const bar = {
  id: '1', children: [
    { id: 'root-link', parentId: '1', title: '根目录', url: 'https://root.example/' },
    { id: 'folder-a', parentId: '1', title: '工作', children: [
      { id: 'a-link', parentId: 'folder-a', title: '项目', url: 'https://project.example/' },
      { id: 'nested', parentId: 'folder-a', title: '深层', children: [
        { id: 'deep-link', parentId: 'nested', title: '文档', url: 'https://docs.example/' },
        { id: 'script-link', parentId: 'nested', title: '脚本', url: 'java\nscript:alert(1)' }
      ] }
    ] },
    { id: 'folder-b', parentId: '1', title: '生活', children: [] }
  ]
};

function setup(initialTree = bar) {
  const elements = new Map();
  const document = {
    hidden: false,
    activeElement: null,
    createElement(tag) { return new Element(tag, document); },
    getElementById(id) {
      if (elements.has(id)) return elements.get(id);
      const walk = element => element.id === id ? element : element.children.map(walk).find(Boolean);
      return walk(elements.get('bookmark-tabs'));
    },
    addEventListener(name, callback) { this[name] = callback; }
  };
  for (const id of [
    'bookmark-tabs', 'bookmark-sites', 'date-time', 'date-label', 'clock', 'lunar-date', 'holiday-status',
    'edit-dialog', 'edit-form', 'edit-title', 'edit-url', 'edit-error',
    'move-dialog', 'move-form', 'move-name', 'move-folder', 'move-position', 'move-error',
    'delete-dialog', 'delete-form', 'delete-name', 'delete-error'
  ]) {
    elements.set(id, document.createElement('div'));
  }
  for (const name of ['edit', 'move', 'delete']) {
    const cancel = document.createElement('button');
    cancel.className = 'dialog-cancel';
    elements.get(`${name}-dialog`).append(cancel);
    const submit = document.createElement('button');
    submit.type = 'submit';
    elements.get(`${name}-form`).append(submit);
    elements.get(`${name}-dialog`).append(elements.get(`${name}-form`));
  }
  const events = {};
  const requests = [];
  const changes = [];
  const chrome = {
    runtime: { lastError: null },
    bookmarks: {
      getSubTree(id, callback) { assert.equal(id, '1'); requests.push(callback); },
      update(id, value, callback) { changes.push({ action: 'update', id, value, callback }); },
      move(id, value, callback) { changes.push({ action: 'move', id, value, callback }); },
      remove(id, callback) { changes.push({ action: 'remove', id, callback }); },
      ...Object.fromEntries(['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']
        .map(name => [name, { addListener(callback) { events[name] = callback; } }]))
    }
  };
  const context = vm.createContext({ document, chrome, URL, Intl, Date, Set, console, setInterval() {} });
  vm.runInContext(source, context);
  document.DOMContentLoaded();
  requests.shift()([initialTree]);
  return { context, document, elements, events, requests, changes, chrome };
}

function titles(container) {
  return container.children.map(row => row.children[0].children[0].children[0].textContent);
}

test('all includes root bookmarks and every descendant; folder tabs only show their descendants', () => {
  const { context } = setup();
  const groups = vm.runInContext('bookmarkGroups', context)(bar);
  assert.deepEqual(Array.from(groups, group => [group.title, Array.from(group.items, item => item.id)]), [
    ['全部', ['root-link', 'a-link', 'deep-link', 'script-link']],
    ['工作', ['a-link', 'deep-link', 'script-link']],
    ['生活', []]
  ]);
});

test('switching tabs flattens bookmarks, handles empty folders and blocks script URLs', () => {
  const { elements } = setup();
  const tabs = elements.get('bookmark-tabs');
  const sites = elements.get('bookmark-sites');
  assert.deepEqual(titles(sites), ['根目录', '项目', '文档', '脚本']);
  assert.deepEqual(tabs.children.map(tab => tab.children[1].textContent), ['4', '3', '0']);
  assert.equal(sites.children[3].children[0].tag, 'span');
  assert.equal(sites.children[3].children[0].href, undefined);

  tabs.children[1].click();
  assert.deepEqual(titles(sites), ['项目', '文档', '脚本']);
  assert.equal(tabs.children[1].attributes['aria-selected'], 'true');
  tabs.listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(sites.children[0].textContent, '暂无书签');
});

test('bookmark changes reload content while retaining the selected folder and ignoring stale responses', () => {
  const { document, elements, events, requests } = setup();
  const tabs = elements.get('bookmark-tabs');
  const sites = elements.get('bookmark-sites');
  tabs.children[1].click();
  events.onCreated();
  events.onChanged();
  assert.equal(requests.length, 2);
  requests.pop()([{ ...bar, children: [bar.children[0], {
    ...bar.children[1], children: [{ id: 'new-link', title: '新书签', url: 'https://new.example/' }]
  }, bar.children[2]] }]);
  assert.deepEqual(titles(sites), ['新书签']);
  assert.equal(tabs.children[1].attributes['aria-selected'], 'true');
  assert.equal(tabs.contains(document.activeElement), true);
  requests.pop()([bar]);
  assert.deepEqual(titles(sites), ['新书签']);
});

test('removing a selected folder falls back to all bookmarks', () => {
  const { elements, events, requests } = setup();
  const tabs = elements.get('bookmark-tabs');
  tabs.children[1].click();
  events.onRemoved();
  requests.shift()([{ ...bar, children: [bar.children[0], bar.children[2]] }]);
  assert.deepEqual(titles(elements.get('bookmark-sites')), ['根目录']);
  assert.equal(tabs.children[0].attributes['aria-selected'], 'true');
});

function submit(elements, name) {
  const form = elements.get(`${name}-form`);
  form.listeners.submit({ currentTarget: form, preventDefault() {} });
}

test('editing saves the bookmark title and URL and reports API errors in the dialog', () => {
  const { elements, changes, chrome, requests } = setup();
  elements.get('bookmark-sites').children[1].children[1].children[0].click();
  assert.equal(elements.get('edit-dialog').open, true);
  assert.equal(elements.get('edit-title').value, '项目');
  elements.get('edit-title').value = ' 新项目 ';
  elements.get('edit-url').value = 'https://new.example/page';
  submit(elements, 'edit');
  assert.deepEqual(JSON.parse(JSON.stringify(changes[0], ['action', 'id', 'value', 'title', 'url'])), {
    action: 'update', id: 'a-link', value: { title: '新项目', url: 'https://new.example/page' }
  });
  chrome.runtime.lastError = { message: 'read only' };
  changes[0].callback();
  chrome.runtime.lastError = null;
  assert.equal(elements.get('edit-dialog').open, true);
  assert.match(elements.get('edit-error').textContent, /read only/);
  submit(elements, 'edit');
  changes[1].callback();
  assert.equal(elements.get('edit-dialog').open, false);
  assert.equal(requests.length, 1);
});

test('moving chooses a nested folder and an exact direct-child insertion point', () => {
  const { elements, changes } = setup();
  elements.get('bookmark-sites').children[2].children[1].children[1].click();
  const folder = elements.get('move-folder');
  const position = elements.get('move-position');
  assert.deepEqual(folder.children.map(option => option.value), ['1', 'folder-a', 'nested', 'folder-b']);
  folder.value = 'folder-a';
  folder.listeners.change();
  position.value = 'after:a-link';
  submit(elements, 'move');
  assert.deepEqual(JSON.parse(JSON.stringify(changes[0], ['action', 'id', 'value', 'parentId', 'index'])), {
    action: 'move', id: 'deep-link', value: { parentId: 'folder-a', index: 1 }
  });
});

test('moving within the current folder can place a bookmark at the front', () => {
  const { elements, changes } = setup();
  elements.get('bookmark-sites').children[3].children[1].children[1].click();
  assert.equal(elements.get('move-folder').value, 'nested');
  elements.get('move-position').value = 'start';
  submit(elements, 'move');
  assert.equal(changes[0].id, 'script-link');
  assert.equal(changes[0].value.parentId, 'nested');
  assert.equal(changes[0].value.index, 0);
});

test('invalid edits are rejected without changing the bookmark', () => {
  const { elements, changes } = setup();
  elements.get('bookmark-sites').children[0].children[1].children[0].click();
  elements.get('edit-url').value = 'not a URL';
  submit(elements, 'edit');
  assert.equal(changes.length, 0);
  assert.match(elements.get('edit-error').textContent, /有效的网址/);
});

test('delete requires confirmation; cancel does not call the bookmarks API', () => {
  const { elements, changes, chrome, requests } = setup();
  const deleteButton = elements.get('bookmark-sites').children[0].children[1].children[2];
  deleteButton.click();
  assert.equal(elements.get('delete-dialog').open, true);
  assert.equal(changes.length, 0);
  elements.get('delete-dialog').querySelector('.dialog-cancel').click();
  assert.equal(changes.length, 0);
  deleteButton.click();
  submit(elements, 'delete');
  assert.deepEqual({ action: changes[0].action, id: changes[0].id }, { action: 'remove', id: 'root-link' });
  assert.equal(elements.get('delete-dialog').querySelector('.dialog-cancel').disabled, true);
  let escapeBlocked = false;
  elements.get('delete-dialog').listeners.cancel({ preventDefault() { escapeBlocked = true; } });
  assert.equal(escapeBlocked, true);
  chrome.runtime.lastError = { message: 'managed bookmark' };
  changes[0].callback();
  chrome.runtime.lastError = null;
  assert.equal(elements.get('delete-dialog').open, true);
  assert.match(elements.get('delete-error').textContent, /managed bookmark/);
  submit(elements, 'delete');
  changes[1].callback();
  assert.equal(elements.get('delete-dialog').open, false);
  assert.equal(requests.length, 1);
});
