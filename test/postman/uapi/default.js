const http = require('node:http');

// 仅供本地测试；异常城市名用于选择响应，并非真实供应商参数。
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const send = (status, data) => { res.writeHead(status); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/v1/misc/district') {
    if (!url.searchParams.has('lat') || !url.searchParams.has('lng')) {
      send(400, { code: 'INVALID_PARAMETER', message: 'lat and lng are required' });
      return;
    }
    const overseas = Number(url.searchParams.get('lng')) < 0;
    const missingDistrict = url.searchParams.get('lat') === '23.000' && url.searchParams.get('level') === 'district';
    send(200, { total: missingDistrict ? 0 : 1, results: missingDistrict ? [] : [{
      name: '东城区', level: url.searchParams.get('level'), country_code: overseas ? 'US' : 'CN',
      province: '北京市', city: '北京城区', district: '东城区', adcode: overseas ? '' : '110101'
    }] });
    return;
  }
  if (url.pathname !== '/api/v1/misc/weather') { send(501, { code: 'NOT_IMPLEMENTED' }); return; }
  const city = url.searchParams.get('city');
  if (!city && !url.searchParams.get('adcode')) { send(400, { code: 'INVALID_PARAMETER' }); return; }
  if (city === '服务异常') { send(503, { code: 'SERVICE_UNAVAILABLE' }); return; }
  if (city === '限流') { send(429, { code: 'RATE_LIMITED' }); return; }
  if (city === '未知城市') { send(404, { code: 'NOT_FOUND' }); return; }
  if (city === '代理异常') { res.writeHead(500, { 'Content-Type': 'text/html' }); res.end('<html>Error</html>'); return; }
  const data = {
    province: '北京市', city: '北京城区', district: '东城区', adcode: '110101',
    weather: '晴', weather_icon: '100', temperature: city === '零度' ? 0 : city === '负温' ? -8 : 20,
    wind_direction: '南风', wind_power: '4级', humidity: city === '零度' ? 0 : 43,
    report_time: '2026-10-19 15:30:00'
  };
  if (city === '缺温度') data.temperature = null;
  if (city === '超时') { setTimeout(() => send(200, data), 300); return; }
  send(200, data);
}).listen(process.env.PORT || 4918);
