const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createWeatherClient, weatherReportLabel } = require('../weather.js');

const baseUrl = process.env.MYTAB_WEATHER_TEST_BASE;
const httpTest = (name, fn) => test(name, { skip: baseUrl ? false : 'Start the local Postman simulation and set MYTAB_WEATHER_TEST_BASE.' }, fn);

test('relative and absolute observation times use Beijing time instead of the device timezone', () => {
  const fetchedAt = Date.parse('2026-10-19T15:40:00+08:00');
  assert.equal(weatherReportLabel('10 分钟前发布', fetchedAt), weatherReportLabel('2026-10-19 15:30:00', fetchedAt));
  assert.match(weatherReportLabel('1小时前发布', fetchedAt), /14:40/);
  assert.match(weatherReportLabel('2026-10-19 15:30:00', fetchedAt), /15:30.*观测/);
  assert.equal(weatherReportLabel('', fetchedAt), '观测时间未知');
  assert.equal(weatherReportLabel(null, fetchedAt), '观测时间未知');
});

test('invalid coordinates and missing locations are rejected before a network request', async () => {
  const client = createWeatherClient('http://127.0.0.1:1');
  await assert.rejects(client.locate(100, 116), /当前位置无效/);
  await assert.rejects(client.locate(30, NaN), /当前位置无效/);
  await assert.rejects(client.current({}), /请选择天气位置/);
});

httpTest('coordinates resolve to an adcode and request Chinese weather over real HTTP', async () => {
  const client = createWeatherClient(baseUrl);
  const location = await client.locate(39.9042, 116.4074);
  assert.deepEqual(location, { adcode: '110101' });
  const result = await client.current(location);
  assert.equal(result.city, '北京城区');
  assert.equal(result.district, '东城区');
  assert.equal(result.temperature, 20);
  assert.equal(result.condition, '晴');
  assert.equal(result.wind, '南风 4级');
  assert.equal(result.humidity, 43);
});

httpTest('places without district results fall back to the city level; overseas locations are not guessed', async () => {
  const client = createWeatherClient(baseUrl);
  assert.equal((await client.locate(23, 113)).adcode, '110101');
  await assert.rejects(client.locate(40, -74), /未找到附近国内城市/);
});

httpTest('zero degrees, zero humidity and negative temperatures remain valid', async () => {
  const client = createWeatherClient(baseUrl);
  const zero = await client.current({ city: '零度' });
  assert.equal(zero.temperature, 0);
  assert.equal(zero.humidity, 0);
  assert.equal((await client.current({ city: '负温' })).temperature, -8);
  await assert.rejects(client.current({ city: '缺温度' }), /天气数据不完整/);
  await assert.rejects(client.current({ adcode: '310101' }), /天气数据不完整/);
});

httpTest('upstream 404, 429, 503 and proxy HTML errors provide actionable messages', async () => {
  const client = createWeatherClient(baseUrl);
  await assert.rejects(client.current({ city: '未知城市' }), /未找到该城市/);
  await assert.rejects(client.current({ city: '限流' }), /请求较多/);
  await assert.rejects(client.current({ city: '服务异常' }), /暂不可用/);
  await assert.rejects(client.current({ city: '代理异常' }), /暂不可用/);
});

httpTest('a hanging HTTP request is aborted at the configured timeout', async () => {
  const client = createWeatherClient(baseUrl, 100);
  await assert.rejects(client.current({ city: '超时' }), /查询超时/);
});

function setupWidget({ city = '', cache = null, denied = false, storageBlocked = false } = {}) {
  const elements = new Map();
  const document = {
    hidden: false,
    getElementById(id) { return elements.get(id); },
    addEventListener(name, callback) { this[name] = callback; }
  };
  const html = fs.readFileSync(path.join(__dirname, '..', 'newtab.html'), 'utf8');
  for (const [, id] of html.matchAll(/id="(weather[^\"]*)"/g)) {
    elements.set(id, {
      textContent: '', hidden: false, listeners: {}, attributes: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {}
    });
  }
  const stored = new Map([['mytab-weather-city', JSON.stringify(city)]]);
  if (cache) stored.set('mytab-weather-v1', JSON.stringify(cache));
  const positionCalls = [];
  const navigator = { geolocation: {
    getCurrentPosition(resolve, reject, options) {
      positionCalls.push(options);
      if (denied) reject({ code: 1 });
      else resolve({ coords: { latitude: 39.9042, longitude: 116.4074 } });
    }
  } };
  const context = vm.createContext({
    document, navigator, URL, URLSearchParams, AbortController, Intl, Date, fetch,
    setTimeout, clearTimeout, console,
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error('Blocked'); return stored.get(key) || null; },
      setItem(key, value) { if (storageBlocked) throw new Error('Blocked'); stored.set(key, value); }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'weather.js'), 'utf8'), context);
  const ready = vm.runInContext(`initWeather(createWeatherClient(${JSON.stringify(baseUrl)}))`, context);
  return { elements, document, stored, positionCalls, ready };
}

httpTest('widget shows current weather without storing GPS coordinates', async () => {
  const { elements, stored, positionCalls, ready } = setupWidget();
  assert.equal(await ready, true);
  assert.equal(elements.get('weather-location').textContent, '北京市 · 东城区');
  assert.equal(elements.get('weather-temperature').textContent, '20°C');
  assert.equal(elements.get('weather-status').hidden, true);
  assert.equal(elements.get('weather').attributes['aria-busy'], 'false');
  assert.equal(positionCalls.length, 1);
  assert.doesNotMatch(stored.get('mytab-weather-v1'), /latitude|longitude|39\.904|116\.407/);
});

httpTest('denied geolocation makes no weather guess and allows a manual city', async () => {
  const { elements, stored, positionCalls, ready } = setupWidget({ denied: true });
  assert.equal(await ready, false);
  assert.match(elements.get('weather-status').textContent, /定位未授权/);
  assert.equal(elements.get('weather-temperature').textContent, '');
  elements.get('weather-location').listeners.click();
  elements.get('weather-city').value = '零度';
  elements.get('weather-form').listeners.submit({ preventDefault() {} });
  await waitUntil(() => elements.get('weather-temperature').textContent === '0°C');
  assert.equal(elements.get('weather-dialog').open, false);
  assert.equal(stored.get('mytab-weather-city'), JSON.stringify('零度'));
  assert.equal(positionCalls.length, 1);
});

httpTest('fresh cache is used, while a forced refresh failure keeps and labels the previous result', async () => {
  const cached = {
    locationKey: 'city:服务异常', fetchedAt: Date.now(),
    data: { city: '杭州市', district: '', temperature: 24, condition: '多云', wind: '', humidity: null, reportTime: '' }
  };
  const { elements, ready } = setupWidget({ city: '服务异常', cache: cached });
  assert.equal(await ready, true);
  assert.equal(elements.get('weather-temperature').textContent, '24°C');
  assert.equal(await elements.get('weather-refresh').listeners.click(), false);
  assert.equal(elements.get('weather-temperature').textContent, '24°C');
  assert.match(elements.get('weather-status').textContent, /暂不可用.*上次结果/);
});

httpTest('corrupt or expired cache does not prevent a fresh weather query', async () => {
  for (const cache of [{ locationKey: 'city:零度', fetchedAt: Date.now(), data: null }, {
    locationKey: 'city:零度', fetchedAt: Date.now() - 11 * 60 * 1000,
    data: { city: '旧城市', condition: '晴', temperature: 99 }
  }]) {
    const { elements, ready } = setupWidget({ city: '零度', cache });
    assert.equal(await ready, true);
    assert.equal(elements.get('weather-temperature').textContent, '0°C');
  }
});

httpTest('fresh automatic-location cache avoids another GPS lookup until forced refresh', async () => {
  const cache = {
    locationKey: 'adcode:110101', fetchedAt: Date.now(),
    data: { city: '北京市', district: '东城区', temperature: 18, condition: '多云', wind: '', humidity: null, reportTime: '' }
  };
  const { elements, positionCalls, ready } = setupWidget({ cache });
  assert.equal(await ready, true);
  assert.equal(positionCalls.length, 0);
  assert.equal(elements.get('weather-temperature').textContent, '18°C');
  assert.equal(await elements.get('weather-refresh').listeners.click(), true);
  assert.equal(positionCalls.length, 1);
  assert.equal(elements.get('weather-temperature').textContent, '20°C');
});

httpTest('weather still works when localStorage is blocked', async () => {
  const { elements, ready } = setupWidget({ storageBlocked: true });
  assert.equal(await ready, true);
  assert.equal(elements.get('weather-temperature').textContent, '20°C');
});

async function waitUntil(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(predicate(), true, 'Widget did not finish its HTTP request');
}
