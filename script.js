const RECENT_COUNT = 20;

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
  const container = document.getElementById('recent-sites');
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

  if (typeof chrome === 'undefined' || !chrome.history?.search) {
    container.innerHTML = '<div class="empty-tip">最近访问仅在浏览器扩展中显示。</div>';
    return;
  }
  loadRecentSites(container);
});

function loadRecentSites(container) {
  chrome.history.search({ text: '', maxResults: 200, startTime: 0 }, historyItems => {
    if (chrome.runtime.lastError) {
      container.innerHTML = '<div class="empty-tip">无法加载最近访问记录，请重新加载扩展。</div>';
      console.error('history error:', chrome.runtime.lastError.message);
      return;
    }

    const items = (historyItems || []).filter(item => {
      try {
        return ['http:', 'https:'].includes(new URL(item.url).protocol);
      } catch (error) {
        return false;
      }
    }).sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0)).slice(0, RECENT_COUNT);
    renderRecentSites(items, container);
  });
}

function renderRecentSites(items, container) {
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-tip">暂无最近访问记录</div>';
    return;
  }

  container.replaceChildren();
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'site-card';

    const link = document.createElement('a');
    link.className = 'site-link';
    link.href = item.url;
    link.title = item.title || item.url;

    const info = document.createElement('span');
    info.className = 'site-info';
    const title = document.createElement('span');
    title.className = 'site-title';
    title.textContent = item.title || '无标题';
    const domain = document.createElement('span');
    domain.className = 'site-domain';
    domain.textContent = new URL(item.url).hostname;
    info.append(title, domain);
    link.appendChild(info);

    const deleteButton = document.createElement('button');
    deleteButton.className = 'site-delete';
    deleteButton.type = 'button';
    deleteButton.textContent = '×';
    deleteButton.title = '从历史记录中删除';
    deleteButton.setAttribute('aria-label', `从历史记录中删除 ${item.title || item.url}`);
    deleteButton.addEventListener('click', () => {
      chrome.history.deleteUrl({ url: item.url }, () => {
        if (chrome.runtime.lastError) {
          console.error('history delete error:', chrome.runtime.lastError.message);
          return;
        }
        loadRecentSites(container);
      });
    });

    row.append(link, deleteButton);
    container.appendChild(row);
  }
}
