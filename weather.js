const WEATHER_CACHE_KEY = 'mytab-weather-v1';
const WEATHER_CITY_KEY = 'mytab-weather-city';
const WEATHER_CACHE_TTL = 10 * 60 * 1000;

// UAPI 的天气接口接受城市名或 adcode，不能直接接收经纬度。
// https://uapis.cn/docs/api-reference/get-misc-district
// https://uapis.cn/docs/api-reference/get-misc-weather
function createWeatherClient(baseUrl = 'https://uapis.cn/api/v1', timeoutMs = 10000) {
  async function request(path, params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(`${baseUrl}/${path}`);
      url.search = new URLSearchParams(params).toString();
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        if (response.status === 404 && path === 'misc/weather') throw new Error('未找到该城市，请输入更完整的城市或区县名称。');
        throw new Error(response.status === 429 ? '天气请求较多，请稍后重试。' : '天气服务暂不可用，请稍后重试。');
      }
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw new Error('天气查询超时，请重试。');
      if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('天气服务连接失败，请稍后重试。');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async locate(latitude, longitude) {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
          || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('当前位置无效，请重新定位。');
      // 只查询附近区县；无区县层级的城市再查询市级。经纬度降至三位小数。
      const coordinates = { lat: latitude.toFixed(3), lng: longitude.toFixed(3), limit: '1' };
      let data = await request('misc/district', { ...coordinates, level: 'district' });
      if (Array.isArray(data?.results) && data.results.length === 0) {
        data = await request('misc/district', { ...coordinates, level: 'city' });
      }
      const region = data?.results?.[0];
      if (region?.country_code !== 'CN' || !/^\d{6}$/.test(region.adcode)) {
        throw new Error('未找到附近国内城市，请手动选择城市。');
      }
      return { adcode: region.adcode };
    },
    async current(location) {
      if (!location || (!/^\d{6}$/.test(location.adcode) && !location.city?.trim())) {
        throw new Error('请选择天气位置。');
      }
      const params = location.adcode ? { adcode: location.adcode } : { city: location.city.trim() };
      const data = await request('misc/weather', { ...params, lang: 'zh' });
      if (data?.code === 'NOT_FOUND') throw new Error('未找到该城市，请输入更完整的城市或区县名称。');
      if (!data || data.temperature == null || data.temperature === '' || typeof data.temperature === 'boolean' || !Number.isFinite(Number(data.temperature))
          || typeof data.weather !== 'string' || !data.weather.trim() || typeof data.city !== 'string' || !data.city.trim()
          || (location.adcode && data.adcode && data.adcode !== location.adcode)) {
        throw new Error('天气数据不完整，请稍后重试。');
      }
      // 只保留展示所需字段，缓存中不保存经纬度。
      return {
        city: data.city, district: typeof data.district === 'string' ? data.district : '',
        temperature: Number(data.temperature), condition: data.weather,
        wind: [data.wind_direction, data.wind_power].filter(value => typeof value === 'string').join(' '),
        humidity: data.humidity != null && data.humidity !== '' && Number.isFinite(Number(data.humidity))
          && Number(data.humidity) >= 0 && Number(data.humidity) <= 100 ? Number(data.humidity) : null,
        reportTime: typeof data.report_time === 'string' ? data.report_time : ''
      };
    }
  };
}

function getWeatherPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('浏览器不支持定位，请手动选择城市。'));
      return;
    }
    navigator.geolocation.getCurrentPosition(position => resolve(position.coords), error => {
      reject(new Error(error.code === 1 ? '定位未授权，请允许位置访问或选择城市。'
        : error.code === 3 ? '定位超时，请重试或选择城市。' : '无法获取当前位置，请重试或选择城市。'));
    }, { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10000 });
  });
}

function weatherReportLabel(reportTime, fetchedAt) {
  if (typeof reportTime !== 'string') return '观测时间未知';
  // 相对发布时间先按取数时间还原，避免缓存后仍显示原来的“几分钟前”。
  const relative = reportTime.match(/^(\d+)\s*(分钟|小时)前/);
  const timestamp = relative ? fetchedAt - Number(relative[1]) * (relative[2] === '分钟' ? 60000 : 3600000)
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(reportTime)
      ? Date.parse(`${reportTime.replace(' ', 'T')}+08:00`) : NaN;
  if (!Number.isFinite(timestamp)) return reportTime || '观测时间未知';
  return `${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(timestamp)} 观测`;
}

function initWeather(client = createWeatherClient()) {
  const widget = document.getElementById('weather');
  const locationButton = document.getElementById('weather-location');
  const refresh = document.getElementById('weather-refresh');
  const status = document.getElementById('weather-status');
  const details = document.getElementById('weather-details');
  const dialog = document.getElementById('weather-dialog');
  const cityInput = document.getElementById('weather-city');
  const formError = document.getElementById('weather-error');
  const useLocation = document.getElementById('weather-use-location');
  const submit = document.getElementById('weather-submit');
  let busy = false;
  let shown = null;
  let lastAttempt = 0;
  let citySelection = read(WEATHER_CITY_KEY);
  if (typeof citySelection !== 'string') citySelection = '';

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (error) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* 天气仍可在禁用存储时使用。 */ }
  }
  function render(entry) {
    shown = entry;
    const data = entry.data;
    const city = data.city.replace(/城区$/, '市');
    locationButton.textContent = [city, data.district && data.district !== city ? data.district : ''].filter(Boolean).join(' · ');
    document.getElementById('weather-temperature').textContent = `${Math.round(data.temperature)}°C`;
    document.getElementById('weather-condition').textContent = data.condition;
    document.getElementById('weather-wind').textContent = data.wind;
    document.getElementById('weather-humidity').textContent = data.humidity == null ? '' : `湿度 ${data.humidity}%`;
    document.getElementById('weather-updated').textContent = weatherReportLabel(data.reportTime, entry.fetchedAt);
    details.hidden = false;
  }

  async function load({ city = citySelection, force = false, fromDialog = false } = {}) {
    if (busy) return;
    busy = true;
    lastAttempt = Date.now();
    widget.setAttribute('aria-busy', 'true');
    refresh.disabled = useLocation.disabled = submit.disabled = true;
    status.hidden = false;
    status.textContent = city ? '正在获取天气…' : '正在定位…';
    formError.textContent = '';
    let succeeded = false;
    try {
      const cached = read(WEATHER_CACHE_KEY);
      const age = Date.now() - cached?.fetchedAt;
      const sameSelection = city ? cached?.locationKey === `city:${city}` : /^adcode:\d{6}$/.test(cached?.locationKey);
      let entry = cached;
      // 新标签页在十分钟内复用结果，避免反复定位和消耗公开接口的免费额度。
      if (force || !sameSelection || age < 0 || !(age < WEATHER_CACHE_TTL)
          || !Number.isFinite(cached?.data?.temperature) || typeof cached?.data?.city !== 'string'
          || !cached.data.city || typeof cached.data.condition !== 'string' || !cached.data.condition) {
        const coords = city ? null : await getWeatherPosition();
        const location = city ? { city } : await client.locate(coords.latitude, coords.longitude);
        const data = await client.current(location);
        // fetchedAt 表示本次响应接收时间，不是上游气象观测时间。
        entry = { locationKey: city ? `city:${city}` : `adcode:${location.adcode}`, fetchedAt: Date.now(), data };
      }
      render(entry);
      if (entry !== cached) save(WEATHER_CACHE_KEY, entry);
      save(WEATHER_CITY_KEY, city);
      citySelection = city;
      status.hidden = true;
      if (fromDialog) dialog.close();
      succeeded = true;
    } catch (error) {
      status.textContent = `${error.message}${shown ? ' 当前为上次结果。' : ''}`;
      if (fromDialog) formError.textContent = error.message;
    } finally {
      busy = false;
      widget.setAttribute('aria-busy', 'false');
      refresh.disabled = useLocation.disabled = submit.disabled = false;
    }
    return succeeded;
  }

  locationButton.addEventListener('click', () => {
    cityInput.value = citySelection;
    formError.textContent = '';
    dialog.showModal();
    cityInput.focus();
  });
  document.getElementById('weather-cancel').addEventListener('click', () => dialog.close());
  useLocation.addEventListener('click', () => load({ city: '', force: true, fromDialog: true }));
  document.getElementById('weather-form').addEventListener('submit', event => {
    event.preventDefault();
    const city = cityInput.value.trim();
    if (!city) { formError.textContent = '请输入城市或区县名称。'; return; }
    load({ city, force: true, fromDialog: true });
  });
  refresh.addEventListener('click', () => load({ force: true }));
  // 后台标签页不定时发请求；切回页面时按缓存有效期刷新。
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastAttempt >= WEATHER_CACHE_TTL) {
      lastAttempt = Date.now();
      load();
    }
  });
  return load();
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => initWeather());
if (typeof module !== 'undefined') module.exports = { createWeatherClient, getWeatherPosition, weatherReportLabel, initWeather };
