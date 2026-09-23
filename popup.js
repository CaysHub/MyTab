// 全局变量
let currentTabId = null;
let currentTabUrl = null;
let selectedTabCookies = [];
let selectedTabUrl = null; // 记录当前选中的标签页 URL

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await getCurrentTabInfo();
  await loadTabs();

  // 绑定事件
  document.getElementById('tab-select').addEventListener('change', onTabSelect);
  document.getElementById('refresh-btn').addEventListener('click', loadTabs);
  document.getElementById('copy-all-btn').addEventListener('click', copyAllCookies);
  document.getElementById('delete-all-btn').addEventListener('click', deleteAllCookies);
});

// 获取当前标签页信息
async function getCurrentTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      currentTabUrl = tab.url;
    }
  } catch (error) {
    console.error('获取当前标签页失败:', error);
  }
}

// 加载所有可访问的标签页
async function loadTabs() {
  const select = document.getElementById('tab-select');
  const status = document.getElementById('status');

  select.disabled = true;
  status.textContent = '正在加载标签页...';
  status.className = 'status';

  try {
    const tabs = await chrome.tabs.query({});
    const currentSelectValue = select.value;

    // 清空选项，保留默认选项
    select.innerHTML = '<option value="">-- 请选择标签页 --</option>';

    // 过滤出有 URL 的标签页并按窗口和标签页索引排序（浏览器从左到右的顺序）
    const validTabs = tabs
      .filter(tab => tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://')))
      .sort((a, b) => {
        if (a.windowId !== b.windowId) {
          return a.windowId - b.windowId;
        }
        // 按标签页索引排序（浏览器中从左到右的顺序）
        return a.index - b.index;
      });

    // 按窗口分组
    let currentWindowId = null;
    let tabIndex = 0;
    validTabs.forEach(tab => {
      if (tab.windowId !== currentWindowId) {
        currentWindowId = tab.windowId;
        const group = document.createElement('optgroup');
        group.label = `窗口 ${currentWindowId}`;
        select.appendChild(group);
        tabIndex = 0; // 每个窗口重新计数
      }

      tabIndex++;
      const option = document.createElement('option');
      option.value = tab.id;

      // 截断标题避免过长
      const title = tab.title || '无标题';
      const displayTitle = title.length > 25 ? title.substring(0, 25) + '...' : title;

      // 添加序号便于识别
      let label = `${tabIndex}. ${displayTitle}`;

      // 标记当前标签页
      if (tab.id === currentTabId) {
        label += ' (当前)';
      }

      option.textContent = label;
      option.title = `${title}\n${tab.url}`;

      select.lastElementChild.appendChild(option);
    });

    // 恢复之前的选择
    if (currentSelectValue) {
      select.value = currentSelectValue;
    }

    status.textContent = `已加载 ${validTabs.length} 个标签页`;
    status.className = 'status success';

  } catch (error) {
    console.error('加载标签页失败:', error);
    status.textContent = '加载标签页失败: ' + error.message;
    status.className = 'status error';
  } finally {
    select.disabled = false;
  }
}

// 选择标签页时的处理
async function onTabSelect(event) {
  const tabId = parseInt(event.target.value);
  const cookieList = document.getElementById('cookie-list');
  const copyAllBtn = document.getElementById('copy-all-btn');
  const deleteAllBtn = document.getElementById('delete-all-btn');
  const status = document.getElementById('status');

  if (!tabId) {
    cookieList.innerHTML = '<div class="empty-tip">请先选择标签页</div>';
    copyAllBtn.disabled = true;
    deleteAllBtn.disabled = true;
    selectedTabCookies = [];
    selectedTabUrl = null;
    return;
  }

  cookieList.innerHTML = '<div class="loading">正在加载 Cookies...</div>';
  copyAllBtn.disabled = true;
  deleteAllBtn.disabled = true;
  status.textContent = '';
  status.className = 'status';

  try {
    // 获取标签页信息
    const tab = await chrome.tabs.get(tabId);
    selectedTabUrl = tab.url;
    const url = new URL(tab.url);
    const hostname = url.hostname;

    // 获取所有 cookies，然后按域名过滤
    const allCookies = await chrome.cookies.getAll({});

    // 只保留与选中标签页域名匹配的 cookies
    // 匹配规则：cookie.domain 等于 hostname 或是 hostname 的父域名
    selectedTabCookies = allCookies.filter(cookie => {
      const cookieDomain = cookie.domain;
      // 去掉 domain 前面的点号进行比较
      const normalizedCookieDomain = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;

      // 检查 cookie 域名是否匹配当前 hostname
      // 1. 完全匹配：cookie.domain === hostname
      // 2. 父域名匹配：hostname 以 cookie.domain 结尾（如 .example.com 匹配 www.example.com）
      return normalizedCookieDomain === hostname ||
             hostname.endsWith('.' + normalizedCookieDomain) ||
             hostname === normalizedCookieDomain;
    });

    renderCookieList(selectedTabCookies, hostname);

    const hasCookies = selectedTabCookies.length > 0;
    copyAllBtn.disabled = !hasCookies;
    deleteAllBtn.disabled = !hasCookies;

    status.textContent = `找到 ${selectedTabCookies.length} 个 Cookies`;
    status.className = 'status success';

  } catch (error) {
    console.error('获取 Cookies 失败:', error);
    cookieList.innerHTML = `<div class="empty-tip">获取 Cookies 失败: ${error.message}</div>`;
    status.textContent = '获取 Cookies 失败';
    status.className = 'status error';
  }
}

// 渲染 Cookie 列表
function renderCookieList(cookies, targetHostname) {
  const cookieList = document.getElementById('cookie-list');

  if (cookies.length === 0) {
    cookieList.innerHTML = '<div class="empty-tip">该页面没有可访问的 Cookies</div>';
    return;
  }

  cookieList.innerHTML = '';

  cookies.forEach(cookie => {
    const item = document.createElement('div');
    item.className = 'cookie-item';

    const info = document.createElement('div');
    info.className = 'cookie-info';

    const name = document.createElement('div');
    name.className = 'cookie-name';
    name.textContent = cookie.name;
    name.title = cookie.name;

    const value = document.createElement('div');
    value.className = 'cookie-value';
    const displayValue = cookie.value.length > 30 ? cookie.value.substring(0, 30) + '...' : cookie.value;
    value.textContent = displayValue;
    value.title = cookie.value;

    const domain = document.createElement('div');
    domain.className = 'cookie-domain';
    // 显示 cookie 的域名和路径
    domain.textContent = `${cookie.domain}${cookie.path}`;

    info.appendChild(name);
    info.appendChild(value);
    info.appendChild(domain);

    const actions = document.createElement('div');
    actions.className = 'cookie-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-copy';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => copySingleCookie(cookie, copyBtn));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', () => deleteSingleCookie(cookie, deleteBtn));

    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(actions);
    cookieList.appendChild(item);
  });
}

// 复制文本到剪贴板
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('复制到剪贴板失败:', error);
    return false;
  }
}

// 复制单个 Cookie
async function copySingleCookie(cookie, button) {
  try {
    if (!currentTabUrl) {
      throw new Error('无法获取当前标签页');
    }

    // 设置 cookie 到当前标签页 - 不指定 domain，让浏览器自动使用当前 URL 的域名
    const cookieData = {
      url: currentTabUrl,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite
    };

    // 只有设置了过期时间的 cookie 才需要传递 expirationDate
    if (cookie.expirationDate) {
      cookieData.expirationDate = cookie.expirationDate;
    }

    await chrome.cookies.set(cookieData);

    // 复制到系统剪贴板 (key=value 格式)
    const clipboardText = `${cookie.name}=${cookie.value}`;
    await copyToClipboard(clipboardText);

    // 显示成功状态
    button.textContent = '已复制 ✓';
    button.classList.add('copied');

    setTimeout(() => {
      button.textContent = '复制';
      button.classList.remove('copied');
    }, 1500);

    showStatus(`已复制: ${cookie.name} (含剪贴板)`, 'success');

  } catch (error) {
    console.error('复制 Cookie 失败:', error);
    showStatus(`复制失败: ${error.message}`, 'error');
  }
}

// 复制所有 Cookies
async function copyAllCookies() {
  if (selectedTabCookies.length === 0) return;

  const copyAllBtn = document.getElementById('copy-all-btn');
  copyAllBtn.disabled = true;
  copyAllBtn.textContent = '复制中...';

  let successCount = 0;
  let failCount = 0;
  const clipboardLines = [];

  for (const cookie of selectedTabCookies) {
    try {
      if (!currentTabUrl) {
        throw new Error('无法获取当前标签页');
      }

      // 设置 cookie 到当前标签页 - 不指定 domain，让浏览器自动使用当前 URL 的域名
      const cookieData = {
        url: currentTabUrl,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite
      };

      // 只有设置了过期时间的 cookie 才需要传递 expirationDate
      if (cookie.expirationDate) {
        cookieData.expirationDate = cookie.expirationDate;
      }

      await chrome.cookies.set(cookieData);

      // 收集到剪贴板内容
      clipboardLines.push(`${cookie.name}=${cookie.value}`);

      successCount++;
    } catch (error) {
      console.error(`复制 Cookie ${cookie.name} 失败:`, error);
      failCount++;
    }
  }

  // 复制所有 cookie 到剪贴板（多行格式）
  if (clipboardLines.length > 0) {
    const clipboardText = clipboardLines.join('\n');
    await copyToClipboard(clipboardText);
  }

  copyAllBtn.disabled = false;
  copyAllBtn.textContent = '📋 复制全部到当前页';

  if (failCount === 0) {
    showStatus(`成功复制 ${successCount} 个 Cookies！ (含剪贴板)`, 'success');
  } else {
    showStatus(`成功: ${successCount}, 失败: ${failCount}`, failCount > successCount ? 'error' : 'success');
  }
}

// 删除单个 Cookie
async function deleteSingleCookie(cookie, button) {
  try {
    if (!selectedTabUrl) {
      throw new Error('无法获取选中标签页信息');
    }

    // 构造 cookie 的 URL
    const protocol = cookie.secure ? 'https://' : 'http://';
    const cookieUrl = protocol + cookie.domain.replace(/^\./, '') + cookie.path;

    // 删除 cookie
    await chrome.cookies.remove({
      url: cookieUrl,
      name: cookie.name
    });

    // 从列表中移除
    selectedTabCookies = selectedTabCookies.filter(c =>
      !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path)
    );

    // 重新渲染列表
    const url = new URL(selectedTabUrl);
    renderCookieList(selectedTabCookies, url.hostname);

    // 更新按钮状态
    const hasCookies = selectedTabCookies.length > 0;
    document.getElementById('copy-all-btn').disabled = !hasCookies;
    document.getElementById('delete-all-btn').disabled = !hasCookies;

    // 显示成功状态
    button.textContent = '已删除 ✓';
    button.classList.add('deleted');

    showStatus(`已删除: ${cookie.name}`, 'success');

  } catch (error) {
    console.error('删除 Cookie 失败:', error);
    showStatus(`删除失败: ${error.message}`, 'error');
  }
}

// 删除所有 Cookies
async function deleteAllCookies() {
  if (selectedTabCookies.length === 0) return;

  // 确认对话框
  if (!confirm(`确定要删除选中标签页的 ${selectedTabCookies.length} 个 Cookies 吗？\n\n此操作不可恢复！`)) {
    return;
  }

  const deleteAllBtn = document.getElementById('delete-all-btn');
  deleteAllBtn.disabled = true;
  deleteAllBtn.textContent = '删除中...';

  let successCount = 0;
  let failCount = 0;

  for (const cookie of selectedTabCookies) {
    try {
      // 构造 cookie 的 URL
      const protocol = cookie.secure ? 'https://' : 'http://';
      const cookieUrl = protocol + cookie.domain.replace(/^\./, '') + cookie.path;

      await chrome.cookies.remove({
        url: cookieUrl,
        name: cookie.name
      });

      successCount++;
    } catch (error) {
      console.error(`删除 Cookie ${cookie.name} 失败:`, error);
      failCount++;
    }
  }

  // 清空列表
  selectedTabCookies = [];
  const cookieList = document.getElementById('cookie-list');
  cookieList.innerHTML = '<div class="empty-tip">该页面没有可访问的 Cookies</div>';

  // 更新按钮状态
  document.getElementById('copy-all-btn').disabled = true;
  deleteAllBtn.disabled = true;
  deleteAllBtn.textContent = '🗑️ 删除选中页全部Cookie';

  if (failCount === 0) {
    showStatus(`成功删除 ${successCount} 个 Cookies！`, 'success');
  } else {
    showStatus(`成功: ${successCount}, 失败: ${failCount}`, failCount > successCount ? 'error' : 'success');
  }
}

// 显示状态消息
function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;

  setTimeout(() => {
    status.textContent = '';
    status.className = 'status';
  }, 3000);
}
