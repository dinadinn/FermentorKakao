'use strict';

(() => {
  const config = window.DASHBOARD_CONFIG || {};
  const $ = id => document.getElementById(id);
  const fields = [
    { name: 'Suhu DS18B20', unit: '°C', digits: 1, note: 'Batas suhu 52 °C' },
    { name: 'MQ3', unit: 'Rs/R0', digits: 3, note: 'Rasio resistansi sensor' },
    { name: 'pH tanah', unit: 'pH', digits: 2, note: 'Keasaman media' },
    { name: 'CO₂', unit: 'ppm', digits: 0, note: 'Karbon dioksida' },
    { name: 'Suhu SCD40', unit: '°C', digits: 1, note: 'Batas suhu 55 °C' },
    { name: 'RH', unit: '%', digits: 1, note: 'Kelembapan relatif' },
    { name: 'Setpoint', unit: '°C', digits: 1, note: 'Target suhu kontrol' },
    { name: 'u', unit: '(-100..100)', digits: 1, note: 'Keluaran pengendali' },
    { name: 'Duty lampu', unit: '%', digits: 1, note: 'Aktivitas pemanas' },
    { name: 'Kipas', unit: '%', digits: 1, note: 'Aktivitas pendingin' },
    { name: 'Mode Kipas', unit: '', digits: 0, text: true },
    { name: 'Fase', unit: '', digits: 0 },
    { name: 'Solenoid', unit: '', digits: 0, binary: true },
    { name: 'Jam Fermentasi', unit: 'jam', digits: 2 }
  ];
  const headers = ['Waktu', 'Suhu DS18B20 (C)', 'MQ3 (Rs/R0)', 'pH Tanah',
    'CO2 (ppm)', 'Suhu SCD40 (C)', 'RH (%)', 'Setpoint (C)',
    'u (-100..100)', 'Duty Lampu (%)', 'Kipas (%)', 'Mode Kipas', 'Fase', 'Solenoid', 'Jam Ferment.'];
  const dateFormatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const tickFormatter = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  let rows = [], rangeHours = 'all', charts = [], fetching = false;
  let requestFailed = false, invalidRows = 0, fetchMessage = '';
  let rangeChosen = false;
  let accessSettings = null, accessReady = false, accessRevision = 0, activeRequest = null;

  function syncRangeButtons() {
    document.querySelectorAll('[data-hours]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.hours === rangeHours));
    });
  }

  function number(value) {
    if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function timestamp(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
      const n = Number(value), ms = n < 1e12 ? n * 1000 : n;
      return Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime()) ? ms : null;
    }
    if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(String(value))) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  function normalize(input) {
    invalidRows = 0;
    const result = [];
    for (const row of input) {
      if (!Array.isArray(row) || row.length < 11 || row.length > 15) { invalidRows++; continue; }
      const time = timestamp(row[0]);
      if (time === null) { invalidRows++; continue; }
      const mode = row[11] === null || row[11] === undefined ? null : String(row[11]).trim() || null;
      const solenoid = number(row[13]);
      result.push([time, ...row.slice(1, 11).map(number), mode, number(row[12]),
        solenoid === 0 || solenoid === 1 ? solenoid : null, number(row[14])]);
    }
    return result.sort((a, b) => a[0] - b[0]);
  }
  function formatValue(value, index) {
    if (value === null || value === undefined || value === '') return '--';
    if (fields[index].text) return value;
    if (fields[index].binary) return value === 1 ? 'ON' : 'OFF';
    return value === null ? '--' : value.toLocaleString('id-ID', {
      minimumFractionDigits: fields[index].digits, maximumFractionDigits: fields[index].digits
    });
  }
  function badge(id, text, kind = '') {
    $(id).textContent = text;
    $(id).className = `badge ${kind}`;
  }
  function showMessages() {
    const messages = [];
    if (fetchMessage) messages.push(fetchMessage);
    if (invalidRows) messages.push(`${invalidRows} baris dengan format/waktu tidak valid diabaikan.`);
    if (typeof window.Chart !== 'function') messages.push('Chart.js gagal dimuat. Periksa koneksi CDN; kartu, tabel, dan CSV tetap tersedia.');
    $('error').textContent = messages.join(' ');
    $('error').hidden = !messages.length;
  }
  function renderStatus() {
    const latest = rows.at(-1);
    if (!latest) {
      badge('connection', requestFailed ? 'OFFLINE' : 'BELUM ADA DATA', 'muted');
      $('updated').textContent = 'Terakhir update: --';
      badge('temperature-status', 'SUHU --', 'muted');
      badge('control-status', 'KONTROL --', 'muted');
      return;
    }
    const offline = requestFailed || Date.now() - latest[0] > (config.OFFLINE_AFTER_MS || 120000);
    badge('connection', offline ? 'OFFLINE' : 'ONLINE', offline ? 'danger' : '');
    $('updated').textContent = `Terakhir update: ${dateFormatter.format(latest[0])} WIB`;
    const ds = latest[1], scd = latest[5];
    if ((ds !== null && ds >= 52) || (scd !== null && scd >= 55)) badge('temperature-status', 'OVERTEMP', 'danger');
    else if (ds === null || scd === null) badge('temperature-status', 'SUHU TIDAK LENGKAP', 'muted');
    else badge('temperature-status', 'SUHU NORMAL');
    const u = latest[8], deadband = config.CONTROL_DEADBAND ?? 0.5;
    badge('control-status', u === null ? 'KONTROL --' : u > deadband ? 'PEMANAS' : u < -deadband ? 'PENDINGIN' : 'IDLE', u === null ? 'muted' : '');
    if (offline) {
      $('temperature-status').textContent += ' · DATA TERAKHIR';
      $('control-status').textContent += ' · DATA TERAKHIR';
    }
  }
  function renderCards() {
    const latest = rows.at(-1);
    fields.forEach((field, index) => { $(`value-${index}`).textContent = formatValue(latest ? latest[index + 1] : null, index); });
    const hours = latest?.[14];
    $('fermentation-day').textContent = hours !== null && hours !== undefined
      ? `Hari ke-${Math.ceil(hours / 24)}` : '--';
  }
  function renderTable() {
    const body = $('table-body');
    body.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = 15; td.textContent = 'Belum ada data pengukuran.';
      tr.append(td); body.append(tr); return;
    }
    for (const row of rows.slice(-50).reverse()) {
      const tr = document.createElement('tr');
      row.forEach((value, index) => {
        const td = document.createElement('td');
        td.textContent = index === 0 ? `${dateFormatter.format(value)} WIB` : formatValue(value, index - 1);
        tr.append(td);
      });
      body.append(tr);
    }
  }
  function filteredRows() {
    if (rangeHours === 'session') {
      let start = rows.length - 1;
      while (start > 0 && rows[start][0] - rows[start - 1][0] <= 600000) start--;
      return rows.slice(Math.max(0, start));
    }
    if (rangeHours === 'all') return rows;
    const cutoff = Date.now() - Number(rangeHours) * 3600000;
    return rows.filter(row => row[0] >= cutoff);
  }
  function series(data, column, label, color, extra = {}) {
    const points = [];
    data.forEach((row, index) => {
      // Sisipkan pemutus khusus grafik; rows untuk kartu/tabel/CSV tetap utuh.
      if (index > 0 && row[0] - data[index - 1][0] > 120000) {
        points.push({ x: data[index - 1][0] + 1, y: null });
      }
      points.push({ x: row[0], y: row[column] });
    });
    return { label, borderColor: color, backgroundColor: color, data: points,
      pointRadius: context => {
        const index = context.dataIndex, point = points[index];
        if (!point || point.y === null) return 0;
        const before = points[index - 1], after = points[index + 1];
        const connectedBefore = before && before.y !== null && point.x - before.x <= 120000;
        const connectedAfter = after && after.y !== null && after.x - point.x <= 120000;
        return connectedBefore || connectedAfter ? 0 : 3;
      },
      pointHoverRadius: 4, pointHitRadius: 12,
      borderWidth: 2, borderCapStyle: 'round', borderJoinStyle: 'round', fill: false, tension: 0, spanGaps: false, ...extra };
  }
  function limitSeries(data, value, label, color) {
    return { label, reference: true, borderColor: color, borderWidth: 2, borderCapStyle: 'round', borderJoinStyle: 'round',
      borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0, fill: false,
      data: data.length ? [{ x: data[0][0], y: value }, { x: data.at(-1)[0], y: value }] : [] };
  }
  function renderCharts() {
    if (!accessReady) return;
    // Otomatis hanya sampai pengguna memilih rentang sendiri.
    if (!rangeChosen) {
      const latest = rows.at(-1);
      rangeHours = latest && Date.now() - latest[0] > 3600000 ? 'session' : 'all';
      syncRangeButtons();
    }
    const data = filteredRows();
    // Min/max eksplisit mencegah pembulatan skala linear melebar ke tanggal kosong.
    // Satu waktu unik memakai jendela dua detik agar Chart.js tidak memperluas epoch.
    const firstTime = data[0]?.[0], lastTime = data.at(-1)?.[0];
    const xBounds = data.length ? {
      min: firstTime === lastTime ? firstTime - 1000 : firstTime,
      max: firstTime === lastTime ? lastTime + 1000 : lastTime
    } : {};
    renderPanelDetails(data);
    $('range-info').textContent = `${data.length.toLocaleString('id-ID')} titik data ditampilkan dari ${rows.length.toLocaleString('id-ID')} baris yang dimuat. ` +
      (rows.length ? `Cakupan tersedia: ${dateFormatter.format(rows[0][0])} – ${dateFormatter.format(rows.at(-1)[0])} WIB.` : '');
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--muted').trim(), grid = css.getPropertyValue('--line').trim();
    const chartGrid = css.getPropertyValue('--chart-grid').trim();
    const color = name => css.getPropertyValue(`--chart-${name}`).trim();
    const chartFont = { family: "'Nunito', 'Segoe UI', sans-serif", size: 14, weight: '600' };
    const sansFont = chartFont;
    const definitions = [
      { id: 'temperature', unit: '°C', columns: [1, 7, 5], datasets: [
        series(data, 1, 'DS18B20', color('brick')),
        series(data, 7, 'Setpoint', color('olive'), { borderDash: [4, 4] }),
        series(data, 5, 'SCD40', color('blue')),
        limitSeries(data, 52, 'Batas 52 °C', color('gray')),
        limitSeries(data, 55, 'Batas 55 °C', color('magenta'))
      ] },
      { id: 'control', unit: 'u (-100..100)', columns: [8], bounds: { min: -100, max: 100 }, datasets: [
        series(data, 8, 'u', color('blue')),
        limitSeries(data, 0, 'Acuan nol', color('gray'))
      ] },
      { id: 'lamp', unit: '%', columns: [9], datasets: [series(data, 9, 'Duty Lampu', color('orange'))] },
      { id: 'fan', unit: '%', columns: [10], datasets: [series(data, 10, 'Kipas', color('olive'))] },
      { id: 'co2', unit: 'ppm', columns: [4], datasets: [series(data, 4, 'CO₂', color('blue'))] },
      { id: 'mq3', unit: 'Rs/R0', columns: [2], datasets: [series(data, 2, 'MQ3', color('magenta'))] },
      { id: 'ph', unit: 'pH', columns: [3], bounds: { min: 0, max: 14 }, datasets: [series(data, 3, 'pH Tanah', color('olive'))] },
      { id: 'humidity', unit: '%', columns: [6], bounds: { min: 0, max: 100 }, datasets: [series(data, 6, 'RH', color('blue'))] }
    ];

    // Angka pojok memakai pengukuran terakhir dalam rentang terpilih,
    // termasuk -- jika sensor kosong pada pengukuran tersebut.
    const latest = data.at(-1);
    definitions.forEach(definition => {
      const element = $(`${definition.id}-latest`);
      element.replaceChildren();
      definition.columns.forEach(column => {
        const line = document.createElement('span');
        line.className = 'latest-line';
        const field = fields[column - 1];
        const label = definition.columns.length > 1 ? `${field.name} ` : '';
        line.textContent = `${label}${formatValue(latest ? latest[column] : null, column - 1)} ${field.unit}`;
        element.append(line);
      });
      element.title = latest ? `${dateFormatter.format(latest[0])} WIB` : 'Tidak ada data dalam rentang ini';
      const plot = $(`${definition.id}-chart`).parentElement;
      let message = plot.querySelector('.chart-empty');
      if (!message) {
        message = document.createElement('p'); message.className = 'chart-empty';
        message.textContent = 'Data belum cukup untuk grafik';
        message.setAttribute('role', 'status'); plot.append(message);
      }
      const validCount = data.filter(row => definition.columns.some(column => row[column] !== null)).length;
      message.hidden = validCount >= 2;
    });
    if (typeof window.Chart !== 'function') return;
    Chart.defaults.font.size = 14;
    Chart.defaults.font.family = "'Nunito', 'Segoe UI', sans-serif";
    Chart.defaults.font.weight = '600';
    charts.forEach(chart => chart.destroy()); charts = [];
    definitions.forEach(definition => {
      charts.push(new Chart($(`${definition.id}-chart`), {
        type: 'line', data: { datasets: definition.datasets }, options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: 'nearest', intersect: false },
          plugins: {
            legend: { display: true, position: 'bottom',
              labels: { color: text, boxWidth: 24, boxHeight: 1, padding: 16, font: sansFont } },
            tooltip: {
              backgroundColor: css.getPropertyValue('--panel').trim(),
              titleColor: css.getPropertyValue('--text').trim(), bodyColor: text,
              borderColor: grid, borderWidth: 1, cornerRadius: 10, padding: 12,
              titleFont: chartFont, bodyFont: chartFont,
              filter: item => !item.dataset.reference && item.parsed.y !== null,
              callbacks: {
                title: items => items.length ? `${dateFormatter.format(items[0].parsed.x)} WIB` : '',
                label: item => `${item.dataset.label}: ${formatValue(item.parsed.y, definition.columns[item.datasetIndex] - 1)} ${definition.unit}`
              }
            }
          },
          scales: {
            x: { type: 'linear', ...xBounds, offset: false, bounds: 'data', grace: 0,
              grid: { display: false }, border: { color: grid }, ticks: { color: text,
              font: chartFont, maxTicksLimit: 4, maxRotation: 0, callback: value => tickFormatter.format(Number(value)) } },
            y: { type: 'linear', position: 'left', ...definition.bounds,
              title: { display: true, text: definition.unit, color: text, font: sansFont },
              ticks: { color: text, font: chartFont, maxTicksLimit: 6 },
              grid: { color: chartGrid, lineWidth: 0.5 }, border: { display: false } }
          }
        }
      }));
    });
  }
  const panelColumns = {
    overview: [1, 5, 6, 4, 2, 3, 7, 8, 9, 10, 11, 12, 13, 14], temperature: [1, 7, 5],
    control: [8], lamp: [9], fan: [10], co2: [4], mq3: [2], ph: [3], humidity: [6]
  };
  const panelDate = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  function panelTime(time) {
    const parts = Object.fromEntries(panelDate.formatToParts(time).map(part => [part.type, part.value]));
    const month = parts.month.charAt(0).toUpperCase() + parts.month.slice(1);
    return `${parts.day} ${month} ${parts.year} ${parts.hour}.${parts.minute}`;
  }
  const dailyColumns = [1, 5, 6, 4, 2, 3, 7, 8, 9, 10];
  const dailyMetrics = { average: 'Rata-rata', min: 'Minimum', max: 'Maksimum', count: 'Jumlah data' };
  const DAY_MS = 86400000;
  let dailyMetric = 'average';
  let dailySummary = { days: [], overall: [], invalidStart: false };

  function wibDay(time) {
    return new Date(time + 7 * 3600000).toISOString().slice(0, 10);
  }
  function calendarTime(date) { return Date.parse(`${date}T00:00:00Z`); }
  function validStartDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = calendarTime(value);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }
  function emptyStatistics() {
    return dailyColumns.map(() => ({ count: 0, sum: 0, min: null, max: null, average: null }));
  }
  function addStatistics(statistics, row) {
    dailyColumns.forEach((column, index) => {
      const value = row[column];
      if (value === null || !Number.isFinite(value)) return;
      const stat = statistics[index];
      stat.count++; stat.sum += value;
      stat.min = stat.min === null ? value : Math.min(stat.min, value);
      stat.max = stat.max === null ? value : Math.max(stat.max, value);
    });
  }
  function finishStatistics(statistics) {
    statistics.forEach(stat => { stat.average = stat.count ? stat.sum / stat.count : null; });
    return statistics;
  }
  function summarizeDaily(input, startDate = config.FERM_START_DATE || '', now = Date.now()) {
    const groups = new Map(), overall = emptyStatistics();
    const invalidStart = Boolean(startDate) && !validStartDate(startDate);
    const anchor = startDate && !invalidStart ? startDate : input[0] && wibDay(input[0][0]);
    const groupInfo = row => {
      const hours = row[14];
      const fermentation = hours !== null && hours !== undefined;
      const date = wibDay(row[0]);
      const number = fermentation ? Math.floor(hours / 24) + 1
        : Math.round((calendarTime(date) - calendarTime(anchor)) / DAY_MS) + 1;
      return { key: fermentation ? `fermentation:${number}` : `wib:${date}`, fermentation, number, date };
    };
    input.forEach(row => {
      const info = groupInfo(row);
      if (!groups.has(info.key)) groups.set(info.key, { ...info, records: 0, statistics: emptyStatistics(),
        firstTime: row[0], lastTime: row[0], dates: new Set(), phases: new Set(), modes: new Set(),
        hoursMin: null, hoursMax: null, solenoidHours: null });
      const day = groups.get(info.key); day.records++;
      day.firstTime = Math.min(day.firstTime, row[0]); day.lastTime = Math.max(day.lastTime, row[0]);
      day.dates.add(info.date);
      if (row[12] !== null && row[12] !== undefined) day.phases.add(row[12]);
      if (row[11]) day.modes.add(row[11]);
      if (row[13] === 0 || row[13] === 1) day.solenoidHours ??= 0;
      if (row[14] !== null && row[14] !== undefined) {
        day.hoursMin = day.hoursMin === null ? row[14] : Math.min(day.hoursMin, row[14]);
        day.hoursMax = day.hoursMax === null ? row[14] : Math.max(day.hoursMax, row[14]);
      }
      addStatistics(day.statistics, row); addStatistics(overall, row);
    });
    // Status pembacaan sebelumnya berlaku sampai pembacaan berikutnya, maksimal 2 menit.
    // Tidak mengekstrapolasi titik terakhir atau mengisi celah komunikasi.
    for (let i = 1; i < input.length; i++) {
      const previous = input[i - 1], next = input[i], duration = next[0] - previous[0];
      if (previous[13] !== 1 || (next[13] !== 0 && next[13] !== 1) || duration <= 0 || duration > 120000) continue;
      const a = groupInfo(previous), b = groupInfo(next);
      if (a.fermentation !== b.fermentation) continue;
      if (a.key === b.key) groups.get(a.key).solenoidHours += duration / 3600000;
      else {
        let fraction;
        if (a.fermentation) {
          if (b.number !== a.number + 1 || next[14] <= previous[14]) continue;
          fraction = (a.number * 24 - previous[14]) / (next[14] - previous[14]);
        } else {
          const midnight = calendarTime(b.date) - 7 * 3600000;
          fraction = (midnight - previous[0]) / duration;
        }
        fraction = Math.max(0, Math.min(1, fraction));
        groups.get(a.key).solenoidHours += duration * fraction / 3600000;
        groups.get(b.key).solenoidHours += duration * (1 - fraction) / 3600000;
      }
    }
    const days = Array.from(groups.values()).sort((a, b) => a.firstTime - b.firstTime);
    const today = wibDay(now);
    days.forEach((day, index) => {
      day.preprocess = day.number <= 0;
      if (day.preprocess) day.number = null;
      const dates = Array.from(day.dates).sort();
      day.date = dates.length > 1 ? `${dates[0]} – ${dates.at(-1)}` : dates[0];
      // Basis kelengkapan: 5760 kiriman/hari (interval 15 detik), bukan jumlah sensor.
      day.partial = index === 0 || (day.fermentation ? index === days.length - 1 : dates.at(-1) >= today) || day.records < 5760 * 0.8;
      finishStatistics(day.statistics);
    });
    return { days, overall: finishStatistics(overall), anchor, invalidStart };
  }
  function dailyValue(value, column, count = false) {
    if (value === null) return '--';
    return value.toLocaleString('id-ID', {
      minimumFractionDigits: count || column === 4 ? 0 : 2,
      maximumFractionDigits: count || column === 4 ? 0 : 2
    });
  }
  function renderDailySummary() {
    // Selalu memakai rows asli yang dimuat, bukan filteredRows atau titik grafik.
    dailySummary = summarizeDaily(rows);
    $('daily-note').textContent = 'Memakai seluruh data yang dimuat, terlepas dari rentang grafik. ' +
      'Hari fermentasi = floor(jam/24)+1; jika jam kosong, memakai kalender WIB. ' +
      'Solenoid ON merupakan estimasi antar pembacaan berurutan (celah maksimal 2 menit), tanpa menambah durasi sesudah titik terakhir. ' +
      'Hari pertama, hari berjalan, atau hari dengan kurang dari 4.608 kiriman (80% dari 5.760/hari) ditandai sebagian. ' +
      (dailySummary.invalidStart ? 'FERM_START_DATE tidak valid; hari ke-1 mengikuti tanggal data pertama.' : 'Nilai sensor kosong diabaikan.');
    $('download-daily').disabled = !rows.length;
    $('download-daily-id').disabled = !rows.length;
    renderDailyTable();
  }
  function renderDailyTable() {
    const head = $('daily-head'), body = $('daily-body'), total = $('daily-total');
    head.replaceChildren(); body.replaceChildren(); total.replaceChildren();
    ['Hari ke-N', 'Tanggal (WIB)', 'Fase', 'Solenoid ON (jam)', ...dailyColumns.map(column => `${fields[column - 1].name} (${fields[column - 1].unit})`)].forEach(label => {
      const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; head.append(th);
    });
    $('daily-caption').textContent = `${dailyMetrics[dailyMetric]} harian · WIB · ${dailySummary.days.length} hari dengan data`;
    document.querySelectorAll('[data-daily-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.dailyMetric === dailyMetric)));
    if (!dailySummary.days.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = 14; td.textContent = 'Belum ada data untuk ringkasan harian.'; tr.append(td); body.append(tr);
      return;
    }
    dailySummary.days.forEach(day => {
      const tr = document.createElement('tr');
      const number = document.createElement('th'); number.scope = 'row';
      number.textContent = day.preprocess ? 'praproses' : `Hari ke-${day.number}`;
      number.title = day.fermentation ? 'Berdasarkan Jam Ferment.' : 'Berdasarkan kalender WIB (jam fermentasi kosong)';
      const date = document.createElement('td'); date.textContent = day.date;
      if (day.partial) {
        const badge = document.createElement('span'); badge.className = 'day-label'; badge.textContent = 'sebagian';
        badge.title = `${day.records.toLocaleString('id-ID')} kiriman dari seluruh data yang dimuat.`;
        date.append(badge);
      }
      tr.append(number, date);
      const phase = document.createElement('td'); phase.textContent = Array.from(day.phases).sort((a, b) => a - b).join(', ') || '--';
      const solenoid = document.createElement('td'); solenoid.textContent = dailyValue(day.solenoidHours, 13);
      tr.append(phase, solenoid);
      day.statistics.forEach((stat, index) => {
        const td = document.createElement('td');
        td.textContent = dailyValue(stat[dailyMetric], dailyColumns[index], dailyMetric === 'count');
        td.title = `${stat.count.toLocaleString('id-ID')} data valid`; tr.append(td);
      }); body.append(tr);
    });
    const period = document.createElement('tr'), label = document.createElement('th');
    label.scope = 'row'; label.colSpan = 2; label.textContent = 'Seluruh periode'; period.append(label);
    const phases = document.createElement('td');
    phases.textContent = Array.from(new Set(dailySummary.days.flatMap(day => Array.from(day.phases)))).sort((a,b) => a-b).join(', ') || '--';
    const on = dailySummary.days.map(day => day.solenoidHours).filter(value => value !== null);
    const onTotal = document.createElement('td'); onTotal.textContent = dailyValue(on.length ? on.reduce((sum, value) => sum + value, 0) : null, 13);
    period.append(phases, onTotal);
    dailySummary.overall.forEach((stat, index) => {
      const td = document.createElement('td');
      [['Rata-rata', stat.average], ['Min', stat.min], ['Maks', stat.max]].forEach(([caption, value]) => {
        const line = document.createElement('span'); line.className = 'period-value';
        const name = document.createElement('small'); name.textContent = caption;
        const number = document.createElement('span'); number.textContent = dailyValue(value, dailyColumns[index]);
        line.append(name, number); td.append(line);
      }); period.append(td);
    }); total.append(period);
  }
  function dailyCsv(excelIndonesia = false) {
    const summary = summarizeDaily(rows);
    const headers = ['Hari ke-N', 'Tanggal (WIB)', 'Kelengkapan', 'Jumlah kiriman', 'Mode Kipas', 'Fase', 'Solenoid ON (jam)', 'Jam Ferment. (rentang)'];
    dailyColumns.forEach(column => {
      const field = fields[column - 1];
      headers.push(`${field.name} rata-rata (${field.unit})`, `${field.name} min (${field.unit})`, `${field.name} maks (${field.unit})`, `${field.name} n`);
    });
    const records = summary.days.map(day => {
      const record = [day.preprocess ? 'praproses' : day.number, day.date, day.partial ? 'sebagian' : 'penuh', day.records];
      const onHours = day.solenoidHours === null ? '' : day.solenoidHours.toFixed(2);
      const hours = day.hoursMin === null ? '' : `${day.hoursMin.toFixed(2)} - ${day.hoursMax.toFixed(2)}`;
      record.push(Array.from(day.modes).join(', '), Array.from(day.phases).sort((a,b) => a-b).join(', '),
        excelIndonesia ? onHours.replace('.', ',') : onHours,
        excelIndonesia ? hours.replace(/\./g, ',') : hours);
      day.statistics.forEach((stat, index) => {
        ['average', 'min', 'max'].forEach(metric => {
          const value = stat[metric];
          const formatted = value === null ? '' : value.toFixed(dailyColumns[index] === 4 ? 0 : 2);
          record.push(excelIndonesia ? formatted.replace('.', ',') : formatted);
        }); record.push(stat.count);
      }); return record;
    });
    const delimiter = excelIndonesia ? ';' : ',';
    return '\uFEFF' + [headers, ...records].map(record => record.map(csvCell).join(delimiter)).join('\r\n');
  }
  function downloadDailyCsv(excelIndonesia = false) {
    if (!rows.length) return;
    const url = URL.createObjectURL(new Blob([dailyCsv(excelIndonesia)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `fermentasi-harian${excelIndonesia ? '-excel-indonesia' : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderPanelDetails(data) {
    document.querySelectorAll('[data-panel]').forEach(panel => {
      // Tabel tetap memakai 50 baris terbaru, tidak difilter oleh pilihan grafik.
      const panelRows = panel.dataset.panel === 'data' ? rows.slice(-50) : panel.dataset.panel === 'summary' ? rows : data;
      panel.querySelector('.panel-range').textContent = panelRows.length
        ? `${panelTime(panelRows[0][0])} - ${panelTime(panelRows.at(-1)[0])} WIB`
        : 'Tidak ada data dalam rentang ini · WIB';
      const exportButton = panel.querySelector('[data-export]');
      exportButton.disabled = !panelRows.length;
    });
    renderDailySummary();
    renderBoardHistory(data);
  }
  function renderBoardHistory(data) {
    const latest = data.at(-1);
    const target = latest ? latest[0] - 300000 : 0;
    let baseline = null;
    data.forEach(row => {
      if (row[0] < (latest ? latest[0] : 0) && Math.abs(row[0] - target) <= 120000 &&
          (!baseline || Math.abs(row[0] - target) < Math.abs(baseline[0] - target))) baseline = row;
    });
    const recent = latest ? data.filter(row => row[0] >= latest[0] - 1800000).slice(-120) : [];
    fields.forEach((field, index) => {
      const trend = $(`trend-${index}`);
      if (field.text) {
        trend.textContent = '--'; trend.title = 'Parameter teks tidak memiliki tren numerik.';
        $(`spark-${index}`).replaceChildren(); return;
      }
      const current = latest ? latest[index + 1] : null;
      const previous = baseline ? baseline[index + 1] : null;
      const delta = current === null || previous === null ? null : current - previous;
      const flat = delta !== null && Math.abs(delta) < 0.5 * Math.pow(10, -field.digits);
      const direction = delta === null ? '' : flat ? 'flat' : delta > 0 ? 'up' : 'down';
      trend.className = `trend ${direction}`; trend.replaceChildren();
      if (direction) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', flat ? 'M4 12h16m-4-4 4 4-4 4' : delta > 0 ? 'm5 17 14-10m-7 0h7v7' : 'm5 7 14 10m-7 0h7v-7');
        svg.append(path); trend.append(svg);
      }
      const text = document.createElement('span'); text.textContent = delta === null ? '--' : `${delta > 0 && !flat ? '+' : ''}${field.binary ? (flat ? 0 : delta).toLocaleString('id-ID') : formatValue(flat ? 0 : delta, index)}`;
      trend.append(text);
      trend.title = delta === null ? 'Data pembanding sekitar 5 menit sebelumnya belum tersedia.'
        : `${flat ? 'Datar' : delta > 0 ? 'Naik' : 'Turun'} dibanding ${panelTime(baseline[0])} WIB (${field.unit})`;
      trend.setAttribute('aria-label', trend.title);
      const spark = $(`spark-${index}`); spark.replaceChildren();
      const values = recent.map(row => row[index + 1]).filter(value => value !== null);
      spark.setAttribute('aria-label', `${field.name}: ${values.length ? 'riwayat 30 menit terakhir dalam rentang terpilih' : 'belum ada riwayat valid'}`);
      if (values.length) {
        const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
        const start = recent[0][0], duration = recent.at(-1)[0] - start || 1;
        let pathData = '', connected = false;
        recent.forEach((row, rowIndex) => {
          const value = row[index + 1];
          if (value === null) { connected = false; return; }
          if (rowIndex && row[0] - recent[rowIndex - 1][0] > 120000) connected = false;
          const x = 2 + (row[0] - start) / duration * 136;
          const y = max === min ? 14 : 25 - (value - min) / span * 22;
          pathData += `${connected ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `; connected = true;
        });
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', pathData); spark.append(path);
      }
    });
  }
  function downloadPanelCsv(id) {
    if (id === 'data') { $('download').click(); return; }
    if (id === 'summary') { downloadDailyCsv(); return; }
    const data = filteredRows();
    if (!data.length) return;
    let csvRows;
    {
      const columns = panelColumns[id];
      if (!columns) return;
      csvRows = [[headers[0], ...columns.map(column => headers[column])], ...data.map(row => [
        new Date(row[0] + 7 * 3600000).toISOString().replace('Z', '+07:00'), ...columns.map(column => row[column])
      ])];
    }
    const csv = '\uFEFF' + csvRows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `fermentasi-${id}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function initializeInterface() {
    document.querySelectorAll('[data-daily-metric]').forEach(button => button.addEventListener('click', () => {
      dailyMetric = button.dataset.dailyMetric; renderDailyTable();
    }));
    $('download-daily').addEventListener('click', () => downloadDailyCsv());
    $('download-daily-id').addEventListener('click', () => downloadDailyCsv(true));
    const mobile = matchMedia('(max-width: 760px)');
    const systemTheme = matchMedia('(prefers-color-scheme: dark)');
    let preferredTheme = null;
    try {
      const saved = localStorage.getItem('fermentasi-theme');
      if (saved === 'light' || saved === 'dark') preferredTheme = saved;
    } catch {}
    function setTheme(value) {
      document.documentElement.dataset.theme = value;
      $('theme-toggle').setAttribute('aria-label', `Ganti ke tema ${value === 'dark' ? 'terang' : 'gelap'}`);
      $('theme-toggle').title = $('theme-toggle').getAttribute('aria-label');
    }
    setTheme(preferredTheme || (systemTheme.matches ? 'dark' : 'light'));
    systemTheme.addEventListener('change', event => {
      if (preferredTheme) return;
      setTheme(event.matches ? 'dark' : 'light'); renderCharts();
    });
    $('theme-toggle').addEventListener('click', () => {
      preferredTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(preferredTheme);
      try { localStorage.setItem('fermentasi-theme', preferredTheme); } catch {}
      renderCharts();
    });
    const syncConnection = () => {
      $('sidebar-connection').textContent = $('connection').textContent;
      $('sidebar-connection').className = $('connection').className;
    };
    new MutationObserver(syncConnection).observe($('connection'), { childList: true, attributes: true });
    syncConnection();
    function menu(open, restoreFocus = false) {
      document.body.classList.toggle('menu-open', open);
      $('sidebar-backdrop').hidden = !open;
      $('sidebar-open').setAttribute('aria-expanded', String(open));
      if (open) $('sidebar-collapse').focus();
      else if (restoreFocus) $('sidebar-open').focus();
    }
    $('sidebar-open').addEventListener('click', () => menu(true));
    $('sidebar-backdrop').addEventListener('click', () => menu(false, true));
    $('sidebar-collapse').addEventListener('click', () => {
      if (mobile.matches) { menu(false, true); return; }
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      $('sidebar-collapse').setAttribute('aria-expanded', String(!collapsed));
      $('sidebar-collapse').setAttribute('aria-label', collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar');
      charts.forEach(chart => chart.resize());
    });
    mobile.addEventListener('change', () => menu(false));
    document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', () => {
      document.querySelectorAll('nav a').forEach(item => item.removeAttribute('aria-current'));
      link.setAttribute('aria-current', 'location'); menu(false);
    }));
    document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => downloadPanelCsv(button.dataset.export)));
    let expandedPanel = null, expandedButton = null;
    function closeExpanded() {
      if (expandedPanel) expandedPanel.classList.remove('panel-expanded');
      expandedPanel = null; document.body.classList.remove('panel-open');
      if (expandedButton) {
        expandedButton.setAttribute('aria-pressed', 'false');
        expandedButton.setAttribute('aria-label', `Perbesar panel ${expandedButton.closest('[data-panel]').querySelector('h2').textContent}`);
        expandedButton.title = expandedButton.getAttribute('aria-label'); expandedButton.focus();
      }
      charts.forEach(chart => chart.resize());
    }
    document.querySelectorAll('[data-expand]').forEach(button => button.addEventListener('click', () => {
      const panel = $(button.dataset.expand);
      if (expandedPanel === panel) { closeExpanded(); return; }
      closeExpanded(); expandedPanel = panel; expandedButton = button;
      panel.classList.add('panel-expanded'); document.body.classList.add('panel-open');
      button.setAttribute('aria-pressed', 'true'); button.setAttribute('aria-label', 'Kembalikan ukuran panel');
      button.title = 'Kembalikan ukuran panel'; charts.forEach(chart => chart.resize());
    }));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { closeExpanded(); if (document.body.classList.contains('menu-open')) menu(false, true); }
      if (event.key === 'Tab' && mobile.matches && document.body.classList.contains('menu-open')) {
        const controls = Array.from($('sidebar').querySelectorAll('a, button'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    $('page-fullscreen').addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { $('ui-message').hidden = false; $('ui-message').textContent = 'Browser tidak mengizinkan layar penuh. Gunakan tombol perbesar pada panel.'; }
    });
    document.addEventListener('fullscreenchange', () => {
      $('page-fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Keluar layar penuh' : 'Layar penuh dashboard');
    });
  }
  function render() {
    renderStatus(); renderCards(); renderTable();
    try { renderCharts(); } catch (error) { fetchMessage = `Grafik gagal ditampilkan: ${error.message}`; }
    $('download').disabled = !rows.length;
    showMessages();
  }
  function validScriptUrl(value) {
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value);
  }
  function accessMessage(message) {
    $('access-error').textContent = message;
    $('access-error').hidden = !message;
  }
  function accessBusy(busy) {
    $('access-submit').disabled = busy;
    $('access-submit').textContent = busy ? 'Menghubungkan…' : 'Simpan dan masuk';
    $('access-form').setAttribute('aria-busy', String(busy));
  }
  function openAccess(message = '') {
    accessMessage(message);
    if (!$('access-dialog').open) $('access-dialog').showModal();
  }
  function clearAccessDisplay() {
    charts.forEach(chart => chart.destroy()); charts = [];
    document.querySelectorAll('.chart-latest').forEach(element => { element.textContent = '--'; });
    document.querySelectorAll('.panel-range').forEach(element => { element.textContent = 'Menunggu koneksi · WIB'; });
    document.querySelectorAll('.chart-empty').forEach(element => { element.hidden = true; });
    document.querySelectorAll('[data-export]').forEach(button => { button.disabled = true; });
    $('range-info').textContent = 'Masukkan pengaturan untuk memuat data.';
    renderDailySummary(); renderBoardHistory([]); render();
  }
  function rejectAccess(message, forgetUrl = false) {
    accessRevision++;
    if (activeRequest) activeRequest.abort();
    activeRequest = null; fetching = false; accessReady = false;
    const previousUrl = accessSettings?.url || $('access-url').value;
    accessSettings = null; rows = []; invalidRows = 0; fetchMessage = ''; requestFailed = !forgetUrl;
    try {
      localStorage.removeItem('fk_key');
      if (forgetUrl) localStorage.removeItem('fk_url');
    } catch { /* Penyimpanan diperiksa lagi saat formulir disimpan. */ }
    $('access-url').value = forgetUrl ? '' : previousUrl;
    $('access-key').value = '';
    accessBusy(false); clearAccessDisplay(); openAccess(message);
  }
  function initializeAccess() {
    $('access-dialog').addEventListener('cancel', event => event.preventDefault());
    $('logout').addEventListener('click', () => {
      document.body.classList.remove('menu-open'); $('sidebar-backdrop').hidden = true;
      $('sidebar-open').setAttribute('aria-expanded', 'false');
      rejectAccess('Pengaturan koneksi sudah dihapus dari browser ini.', true);
    });
    $('access-form').addEventListener('submit', event => {
      event.preventDefault();
      if (fetching) return;
      const url = $('access-url').value.trim(), key = $('access-key').value.trim();
      if (!validScriptUrl(url)) {
        accessMessage('URL harus diawali https://script.google.com/macros/s/ dan berakhiran /exec, tanpa query atau fragmen.');
        $('access-url').focus(); return;
      }
      if (!key) { accessMessage('Kunci akses wajib diisi.'); $('access-key').focus(); return; }
      try { localStorage.setItem('fk_url', url); localStorage.setItem('fk_key', key); }
      catch { accessMessage('Pengaturan tidak dapat disimpan. Izinkan penyimpanan lokal pada browser ini.'); return; }
      accessRevision++; accessSettings = { url, key }; accessMessage(''); accessBusy(true);
      $('access-dialog').close(); poll();
    });
    try {
      const url = (localStorage.getItem('fk_url') || '').trim();
      const key = (localStorage.getItem('fk_key') || '').trim();
      $('access-url').value = url;
      if (validScriptUrl(url) && key) { accessSettings = { url, key }; return; }
      openAccess(url || key ? 'URL atau kunci belum lengkap. Periksa kedua isian untuk melanjutkan.' : '');
    } catch { openAccess('Penyimpanan lokal tidak tersedia. Izinkan penyimpanan browser untuk melanjutkan.'); }
  }
  async function poll() {
    if (fetching || !accessSettings || $('access-dialog').open) return;
    const revision = accessRevision;
    const settings = accessSettings;
    fetching = true;
    const controller = new AbortController();
    activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const url = new URL(settings.url);
      url.searchParams.set('action', 'read');
      url.searchParams.set('key', settings.key);
      url.searchParams.set('limit', String(config.READ_LIMIT || 200));
      url.searchParams.set('_', String(Date.now()));
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'follow' });
      if (revision !== accessRevision) return;
      if (response.status === 401 || response.status === 403) {
        rejectAccess('Akses ditolak server. Periksa URL deployment dan kunci akses.'); return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (revision !== accessRevision) return;
      if (payload.error === 'unauthorized') {
        rejectAccess('Kunci akses ditolak. Masukkan kunci yang sama dengan READ_KEY di Apps Script.'); return;
      }
      if (payload.error) throw new Error(String(payload.error));
      if (!Array.isArray(payload.rows)) throw new Error('Respons tidak berisi array rows.');
      const next = normalize(payload.rows);
      if (payload.rows.length && !next.length) throw new Error('Tidak ada baris dengan waktu valid dan 11–15 kolom. Periksa format respons action=read.');
      rows = next; requestFailed = false; fetchMessage = '';
      accessReady = true;
      $('access-key').value = '';
    } catch (error) {
      if (revision !== accessRevision) return;
      requestFailed = true;
      fetchMessage = error.name === 'AbortError'
        ? 'Permintaan melewati batas waktu. Mencoba lagi pada polling berikutnya.'
        : `Gagal mengambil data: ${error.message}. Periksa URL, akses Anyone, dan koneksi internet.`;
      if (!accessReady) openAccess(fetchMessage);
    } finally {
      clearTimeout(timeout);
      if (activeRequest === controller) { activeRequest = null; fetching = false; }
      if (revision === accessRevision) { accessBusy(false); render(); }
    }
  }
  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  $('download').addEventListener('click', () => {
    const csvRows = [headers, ...rows.map(row => [
      new Date(row[0] + 7 * 3600000).toISOString().replace('Z', '+07:00'), ...row.slice(1)
    ])];
    const csv = '\uFEFF' + csvRows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `fermentasi-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const boardOrder = [0, 4, 5, 3, 1, 2, 6, 7, 8, 9, 10, 11, 12, 13];
  const boardColors = ['brick', 'magenta', 'olive', 'blue', 'orange', 'blue', 'olive', 'blue', 'orange', 'olive', 'blue', 'magenta', 'olive', 'orange'];
  boardOrder.forEach(index => {
    const field = fields[index];
    const card = document.createElement('article'); card.className = 'status-row';
    card.style.setProperty('--series-color', `var(--chart-${boardColors[index]})`);
    const label = document.createElement('p'); label.className = 'card-label'; label.textContent = field.name;
    const value = document.createElement('p'); value.className = 'card-value';
    const numberElement = document.createElement('span'); numberElement.id = `value-${index}`; numberElement.textContent = '--';
    const unit = document.createElement('span'); unit.className = 'card-unit'; unit.textContent = field.unit;
    value.append(numberElement, unit);
    if (index === 13) {
      const day = document.createElement('small'); day.id = 'fermentation-day'; day.className = 'card-unit';
      day.textContent = '--'; value.append(day);
    }
    const trend = document.createElement('span'); trend.id = `trend-${index}`; trend.className = 'trend';
    const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spark.id = `spark-${index}`; spark.classList.add('sparkline');
    spark.setAttribute('viewBox', '0 0 140 28'); spark.setAttribute('preserveAspectRatio', 'none');
    spark.setAttribute('role', 'img'); spark.setAttribute('aria-label', `Historis ${field.name}`);
    card.append(label, value, trend, spark); $('cards').append(card);
  });
  headers.forEach(header => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = header; $('table-head').append(th); });
  document.querySelectorAll('[data-hours]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.hours === rangeHours));
    button.addEventListener('click', () => {
      rangeChosen = true;
      rangeHours = button.dataset.hours;
      document.querySelectorAll('[data-hours]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      renderCharts();
    });
  });
  initializeInterface();
  initializeAccess();
  render(); poll();
  setInterval(poll, config.POLL_INTERVAL_MS || 15000);
  setInterval(renderStatus, 1000);
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
        $('ui-message').hidden = false;
        $('ui-message').textContent = 'PWA belum aktif. Buka melalui HTTPS atau localhost untuk mengaktifkannya.';
      });
    });
  }
})();
