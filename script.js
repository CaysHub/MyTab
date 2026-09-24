// 国务院办公厅公布的 2026 年放假、调休和补班安排：
// https://www.gov.cn/zhengce/content/202511/content_7047090.htm
const HOLIDAYS_2026 = [
  { start: '2026-01-01', end: '2026-01-03', name: '元旦' },
  { start: '2026-02-15', end: '2026-02-23', name: '春节' },
  { start: '2026-04-04', end: '2026-04-06', name: '清明节' },
  { start: '2026-05-01', end: '2026-05-05', name: '劳动节' },
  { start: '2026-06-19', end: '2026-06-21', name: '端午节' },
  { start: '2026-09-25', end: '2026-09-27', name: '中秋节' },
  { start: '2026-10-01', end: '2026-10-07', name: '国庆节' }
];
const MAKEUP_WORKDAYS_2026 = new Set([
  '2026-01-04', '2026-02-14', '2026-02-28',
  '2026-05-09', '2026-09-20', '2026-10-10'
]);

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });
const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });

function localDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function lunarDateLabel(date) {
  const parts = lunarFormatter.formatToParts(date);
  const month = parts.find(part => part.type === 'month')?.value;
  const day = Number(parts.find(part => part.type === 'day')?.value);
  if (!month || !Number.isInteger(day) || day < 1 || day > 30) {
    return `农历${lunarFormatter.format(date)}`;
  }
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const lunarDay = day === 10 ? '初十' : day === 20 ? '二十' : day === 30 ? '三十'
    : ['初', '十', '廿'][Math.floor((day - 1) / 10)] + digits[day % 10];
  return `农历${month}${lunarDay}`;
}

function holidayStatus(date) {
  if (date.getFullYear() !== 2026) return { text: '节假日待核实', kind: 'unknown' };
  const key = localDateKey(date);
  const holiday = HOLIDAYS_2026.find(item => key >= item.start && key <= item.end);
  if (holiday) return { text: holiday.name, kind: 'holiday' };
  if (MAKEUP_WORKDAYS_2026.has(key)) return { text: '补班', kind: 'makeup' };
  return date.getDay() === 0 || date.getDay() === 6
    ? { text: '周末', kind: 'weekend' }
    : { text: '工作日', kind: 'workday' };
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('bookmark-sites');
  const tabs = document.getElementById('bookmark-tabs');
  const dateTime = document.getElementById('date-time');
  const dateLabel = document.getElementById('date-label');
  const clock = document.getElementById('clock');
  const lunarDate = document.getElementById('lunar-date');
  const holiday = document.getElementById('holiday-status');
  let shownDate = '';

  function updateTime() {
    const now = new Date();
    clock.textContent = clockFormatter.format(now);
    dateTime.dateTime = now.toISOString();
    const key = localDateKey(now);
    if (key === shownDate) return;
    shownDate = key;
    dateLabel.textContent = `${dateFormatter.format(now)} ${weekdayFormatter.format(now)}`;
    lunarDate.textContent = lunarDateLabel(now);
    const status = holidayStatus(now);
    holiday.textContent = status.text;
    holiday.dataset.kind = status.kind;
  }

  updateTime();
  setInterval(updateTime, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTime(); });

  if (typeof chrome === 'undefined' || !chrome.bookmarks?.getSubTree) {
    const message = document.createElement('div');
    message.className = 'empty-tip';
    message.textContent = '书签仅在浏览器扩展中显示。';
    container.replaceChildren(message);
    return;
  }
  initBookmarks(tabs, container);
});

function collectBookmarks(node) {
  const items = [];
  for (const child of node.children || []) {
    if (child.url) items.push(child);
    else items.push(...collectBookmarks(child));
  }
  return items;
}

function bookmarkGroups(bar) {
  return [
    { id: 'all', title: '全部', items: collectBookmarks(bar) },
    ...(bar.children || []).filter(child => !child.url).map(folder => ({
      id: folder.id, title: folder.title || '未命名文件夹', items: collectBookmarks(folder)
    }))
  ];
}

function bookmarkFolders(bar, prefix = '') {
  const label = prefix ? `${prefix} / ${bar.title || '未命名文件夹'}` : '书签栏';
  return [{ id: bar.id, label, node: bar }, ...(bar.children || [])
    .filter(child => !child.url)
    .flatMap(child => bookmarkFolders(child, label))];
}

function initBookmarks(tabs, container) {
  let selectedId = 'all';
  let requestId = 0;
  let bar;
  let editItem;
  let moveItem;
  let deleteItem;
  const editDialog = document.getElementById('edit-dialog');
  const moveDialog = document.getElementById('move-dialog');
  const deleteDialog = document.getElementById('delete-dialog');
  const editError = document.getElementById('edit-error');
  const moveError = document.getElementById('move-error');
  const deleteError = document.getElementById('delete-error');
  const folderSelect = document.getElementById('move-folder');
  const positionSelect = document.getElementById('move-position');

  for (const dialog of [editDialog, moveDialog, deleteDialog]) {
    dialog.querySelector('.dialog-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => {
      if (dialog.querySelector('[type="submit"]').disabled) event.preventDefault();
    });
  }

  function submitChange(dialog, form, errorElement, change) {
    const submit = form.querySelector('[type="submit"]');
    if (submit.disabled) return;
    const cancel = dialog.querySelector('.dialog-cancel');
    submit.disabled = true;
    cancel.disabled = true;
    errorElement.textContent = '';
    try {
      change(() => {
        const error = chrome.runtime.lastError;
        submit.disabled = false;
        cancel.disabled = false;
        if (error) {
          errorElement.textContent = `操作失败：${error.message}`;
          return;
        }
        dialog.close();
        loadBookmarks();
      });
    } catch (error) {
      submit.disabled = false;
      cancel.disabled = false;
      errorElement.textContent = `操作失败：${error.message}`;
    }
  }

  function openEdit(item) {
    editItem = item;
    document.getElementById('edit-title').value = item.title;
    document.getElementById('edit-url').value = item.url;
    editError.textContent = '';
    editDialog.showModal();
    document.getElementById('edit-title').focus();
  }

  document.getElementById('edit-form').addEventListener('submit', event => {
    event.preventDefault();
    const title = document.getElementById('edit-title').value.trim();
    const rawUrl = document.getElementById('edit-url').value.trim();
    let url;
    try { url = new URL(rawUrl); } catch (error) { /* Report below. */ }
    if (!title || !url) {
      editError.textContent = !title ? '请输入书签名称。' : '请输入完整有效的网址。';
      return;
    }
    submitChange(editDialog, event.currentTarget, editError, done => {
      chrome.bookmarks.update(editItem.id, { title, url: url.href }, done);
    });
  });

  function updatePositions() {
    const folder = bookmarkFolders(bar).find(entry => entry.id === folderSelect.value)?.node;
    positionSelect.replaceChildren();
    if (!folder) return;
    const choices = [{ value: 'start', label: '最前面' }, { value: 'end', label: '最后面' }];
    for (const child of folder.children || []) {
      if (child.id === moveItem.id) continue;
      const name = `${child.url ? '' : '文件夹：'}${child.title || child.url || '未命名文件夹'}`;
      choices.push({ value: `before:${child.id}`, label: `在 ${name} 之前` });
      choices.push({ value: `after:${child.id}`, label: `在 ${name} 之后` });
    }
    for (const choice of choices) {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      positionSelect.appendChild(option);
    }
    positionSelect.value = 'end';
  }

  function openMove(item) {
    moveItem = item;
    document.getElementById('move-name').textContent = item.title || item.url;
    folderSelect.replaceChildren();
    for (const folder of bookmarkFolders(bar)) {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = folder.label;
      folderSelect.appendChild(option);
    }
    folderSelect.value = item.parentId;
    updatePositions();
    moveError.textContent = '';
    moveDialog.showModal();
  }

  folderSelect.addEventListener('change', updatePositions);
  document.getElementById('move-form').addEventListener('submit', event => {
    event.preventDefault();
    const folder = bookmarkFolders(bar).find(entry => entry.id === folderSelect.value)?.node;
    if (!folder) {
      moveError.textContent = '目标文件夹已不存在，请重新选择。';
      return;
    }
    const destination = { parentId: folder.id };
    if (positionSelect.value === 'start') destination.index = 0;
    else if (positionSelect.value !== 'end') {
      const [side, id] = positionSelect.value.split(':');
      const index = folder.children.findIndex(child => child.id === id);
      if (index < 0 || !['before', 'after'].includes(side)) {
        moveError.textContent = '插入位置已变化，请重新选择。';
        return;
      }
      destination.index = index + (side === 'after' ? 1 : 0);
    }
    submitChange(moveDialog, event.currentTarget, moveError, done => {
      chrome.bookmarks.move(moveItem.id, destination, done);
    });
  });

  function openDelete(item) {
    deleteItem = item;
    document.getElementById('delete-name').textContent = item.title ? `${item.title}\n${item.url}` : item.url;
    deleteError.textContent = '';
    deleteDialog.showModal();
  }

  document.getElementById('delete-form').addEventListener('submit', event => {
    event.preventDefault();
    submitChange(deleteDialog, event.currentTarget, deleteError, done => {
      chrome.bookmarks.remove(deleteItem.id, done);
    });
  });

  function render(groups) {
    const selected = groups.find(group => group.id === selectedId) || groups[0];
    const hadTabFocus = tabs.contains(document.activeElement);
    selectedId = selected.id;
    tabs.replaceChildren();
    for (const group of groups) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'bookmark-tab';
      tab.id = `bookmark-tab-${group.id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'bookmark-sites');
      tab.setAttribute('aria-selected', String(group.id === selectedId));
      tab.tabIndex = group.id === selectedId ? 0 : -1;
      tab.title = group.title;
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = group.title;
      const count = document.createElement('span');
      count.className = 'tab-count';
      count.textContent = group.items.length;
      tab.append(label, count);
      tab.addEventListener('click', () => {
        selectedId = group.id;
        render(groups);
        document.getElementById(`bookmark-tab-${group.id}`).focus();
      });
      tabs.appendChild(tab);
    }
    container.setAttribute('aria-labelledby', `bookmark-tab-${selectedId}`);
    renderBookmarks(selected.items, container, { openEdit, openMove, openDelete });
    if (hadTabFocus) document.getElementById(`bookmark-tab-${selectedId}`).focus();
  }

  tabs.addEventListener('keydown', event => {
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next].click();
  });

  function loadBookmarks() {
    const currentRequest = ++requestId;
    // Chromium's permanent Bookmarks Bar folder has ID 1, regardless of its localized title.
    chrome.bookmarks.getSubTree('1', nodes => {
      const error = chrome.runtime.lastError;
      if (currentRequest !== requestId) return;
      if (error || !nodes?.[0]) {
        tabs.replaceChildren();
        container.replaceChildren();
        const message = document.createElement('div');
        message.className = 'empty-tip';
        message.textContent = '无法加载书签栏，请重新加载扩展。';
        container.appendChild(message);
        console.error('bookmarks error:', error?.message || 'Bookmarks Bar not found');
        return;
      }
      bar = nodes[0];
      render(bookmarkGroups(bar));
    });
  }

  for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
    chrome.bookmarks[event]?.addListener(loadBookmarks);
  }
  loadBookmarks();
}

function renderBookmarks(items, container, actions) {
  container.replaceChildren();
  if (items.length === 0) {
    const message = document.createElement('div');
    message.className = 'empty-tip';
    message.textContent = '暂无书签';
    container.appendChild(message);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'site-card';

    let url;
    try {
      url = new URL(item.url);
    } catch (error) {
      // Keep malformed bookmarks visible without creating a relative extension-page link.
    }
    const unsafe = !url || ['javascript:', 'data:', 'vbscript:'].includes(url.protocol);
    const link = document.createElement(unsafe ? 'span' : 'a');
    link.className = 'site-link';
    if (!unsafe) link.href = url.href;
    link.title = item.url;

    const info = document.createElement('span');
    info.className = 'site-info';
    const title = document.createElement('span');
    title.className = 'site-title';
    title.textContent = item.title || item.url;
    const domain = document.createElement('span');
    domain.className = 'site-domain';
    domain.textContent = !url ? item.url : unsafe ? '特殊书签' : url.hostname || url.protocol.slice(0, -1);
    info.append(title, domain);
    link.appendChild(info);

    const buttons = document.createElement('div');
    buttons.className = 'site-actions';
    for (const [label, icon, action, className] of [
      ['编辑', '✎', actions.openEdit, ''],
      ['移动', '↕', actions.openMove, ''],
      ['删除', '🗑', actions.openDelete, 'site-action-danger']
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `site-action ${className}`;
      button.title = label;
      button.setAttribute('aria-label', `${label} ${item.title || item.url}`);
      button.textContent = icon;
      button.addEventListener('click', () => action(item));
      buttons.appendChild(button);
    }
    row.append(link, buttons);
    container.appendChild(row);
  }
}
