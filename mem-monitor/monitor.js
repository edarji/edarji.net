(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const number = value => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(value);
  let dataset;
  const time = stamp => new Intl.DateTimeFormat('es-MX', { timeZone: dataset.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(stamp));
  const validNumber = value => typeof value === 'number' && Number.isFinite(value);
  const validStamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  const stampLabel = stamp => new Intl.DateTimeFormat('es-MX', { timeZone: dataset.timezone, dateStyle:'medium', timeStyle:'short' }).format(new Date(stamp));
  const statusLabels = {official:'CENACE', stale:'SIN ACTUALIZAR', unavailable:'NO DISPONIBLE'};
  function validate(data) {
    const fail = () => { throw new Error('Formato de datos no compatible'); };
    if (data?.schema_version !== 2 || data.mode !== 'official' || !validStamp(data.generated_at)) fail();
    new Intl.DateTimeFormat('es-MX', {timeZone:data.timezone}).format();
    ['demand','pml','generation'].forEach(key => {
      const part = data[key];
      if (!part || !Object.hasOwn(statusLabels, part.status) || !validStamp(part.last_attempt_at) || !(part.stale_after_hours > 0)) fail();
      if (part.status !== 'unavailable' && (!validStamp(part.fetched_at) || typeof part.period !== 'string')) fail();
      const url = new URL(part.source.url);
      if (url.protocol !== 'https:' || !/(^|\.)cenace\.gob\.mx$/.test(url.hostname) || typeof part.source.name !== 'string') fail();
    });
    if (data.demand.unit !== 'MW' || data.demand.system !== 'SIN' || !Array.isArray(data.demand.series)) fail();
    data.demand.series.forEach((r,i,rows) => {
      if (!validStamp(r.timestamp) || !validNumber(r.value) || r.value < 0 || r.timestamp.slice(0,10) !== data.demand.period || (i && Date.parse(r.timestamp) <= Date.parse(rows[i-1].timestamp))) fail();
    });
    if (data.pml.unit !== 'MXN/MWh' || data.pml.market !== 'MDA' || data.pml.system !== 'SIN' || !Array.isArray(data.pml.nodes)) fail();
    const ids = new Set();
    data.pml.nodes.forEach(n => {
      if (typeof n.id !== 'string' || ids.has(n.id) || !Array.isArray(n.series) || n.series.length !== 24) fail();
      ids.add(n.id);
      n.series.forEach((r,i) => { if (r.hour !== i+1 || !validNumber(r.value)) fail(); });
    });
    if (data.generation.unit !== 'MWh' || data.generation.system !== 'SEN' || !Array.isArray(data.generation.items)) fail();
    data.generation.items.forEach(r => { if (typeof r.technology !== 'string' || !validNumber(r.value) || r.value < 0) fail(); });
    for (const key of ['demand','pml','generation']) {
      const rows = key === 'demand' ? data[key].series : key === 'pml' ? data[key].nodes : data[key].items;
      if ((data[key].status === 'unavailable') !== (rows.length === 0)) fail();
    }
  }
  function sourceInfo(key) {
    const part = dataset[key];
    const last = key === 'demand' ? part.series.at(-1)?.timestamp : part.fetched_at;
    const aged = last && Date.now() - Date.parse(last) > part.stale_after_hours * 3600000;
    const historical = key === 'pml' && part.period < new Intl.DateTimeFormat('en-CA', {timeZone:dataset.timezone, year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const status = part.status === 'official' && aged ? 'stale' : part.status;
    $(`${key}-badge`).textContent = historical && status === 'official' ? 'HISTÓRICO' : statusLabels[status];
    $(`${key}-badge`).dataset.status = status;
    const host = $(`${key}-source`); host.replaceChildren();
    const link = document.createElement('a'); link.href = part.source.url; link.textContent = `${part.source.name} ↗`; link.target = '_blank'; link.rel = 'noreferrer'; host.append(link);
    const note = document.createElement('p');
    note.textContent = part.fetched_at ? `Descarga: ${stampLabel(part.fetched_at)}. ${status === 'stale' ? 'Dato sin actualizar; consulta la fuente.' : ''} ${part.error || ''}` : 'Sin una descarga válida. No se sustituyen datos con ejemplos.';
    host.append(note);
  }
  function table(target, headers, rows, caption) {
    const el = document.createElement('table');
    el.createCaption().textContent = caption;
    const head = el.createTHead().insertRow();
    headers.forEach(text => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; head.append(th); });
    const body = el.createTBody();
    rows.forEach(row => { const tr = body.insertRow(); row.forEach(text => { tr.insertCell().textContent = text; }); });
    $(target).replaceChildren(el);
  }
  function chart(target, rows, title, rowLabel) {
    const host = $(target); host.replaceChildren();
    if (!rows.length) { host.textContent = 'Sin observaciones disponibles.'; return; }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 520 190'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${title}. Fuente CENACE; valores completos en la tabla siguiente.`);
    const add = (tag, attrs, content) => { const el = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value)); if (content !== undefined) el.textContent = content; svg.append(el); return el; };
    const min = Math.min(0, ...rows.map(r => r.value));
    const max = Math.max(1, ...rows.map(r => r.value));
    const position = r => r.hour ?? Date.parse(r.timestamp);
    const span = position(rows.at(-1)) - position(rows[0]);
    const x = i => 60 + (span ? (position(rows[i]) - position(rows[0])) / span * 434 : 217);
    const y = value => 152 - (value - min) / (max - min) * 130;
    [min, (min + max) / 2, max].forEach(v => { add('line', { x1:60, x2:494, y1:y(v), y2:y(v), class:'gridline' }); add('text', { x:52, y:y(v) + 4, 'text-anchor':'end' }, number(v)); });
    const points = rows.map((r, i) => `${x(i)},${y(r.value)}`).join(' ');
    if (target === 'pml-chart') add('polygon', { points:`${x(0)},${y(0)} ${points} ${x(rows.length-1)},${y(0)}`, class:'area' });
    if (target === 'pml-chart') add('polyline', { points, class:'trace' });
    rows.forEach((r, i) => { const dot = add('circle', { cx:x(i), cy:y(r.value), r:2.5, fill:'#83bedc' }); const tip = document.createElementNS(ns, 'title'); tip.textContent = `${rowLabel(r)}: ${number(r.value)}`; dot.append(tip); });
    [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])].forEach(i => add('text', { x:x(i), y:179, 'text-anchor':'middle' }, rowLabel(rows[i])));
    host.append(svg);
  }
  function metric(target, value, unit) {
    $(target).replaceChildren(document.createTextNode(value === null ? '— ' : `${number(value)} `));
    const small = document.createElement('small'); small.textContent = unit; $(target).append(small);
  }
  function renderPml() {
    const part = dataset.pml;
    const node = part.nodes.find(n => n.id === $('node-select').value);
    const rows = node?.series ?? [];
    const mean = rows.length ? rows.reduce((sum,r) => sum + r.value, 0) / rows.length : null;
    metric('pml-value', mean, 'MXN/MWh');
    if (mean !== null) $('pml-value').firstChild.textContent = `${mean.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})} `;
    $('pml-caption').textContent = rows.length ? `Promedio aritmético de 24 horas · MDA · ${part.period}` : 'Sin precios verificados';
    chart('pml-chart', rows, `PML ${node?.id || ''}`, r => `H${r.hour}`);
    table('pml-table', ['Hora de operación', 'MXN/MWh'], rows.map(r => [r.hour, r.value.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})]), `PML · ${part.period ?? 'Sin fecha'}`);
  }
  function render() {
    $('period').textContent = 'CORTES INDEPENDIENTES / FUENTES CENACE';
    $('timezone').textContent = dataset.timezone;
    const demand = dataset.demand;
    const last = demand.series.at(-1);
    metric('demand-value', last?.value ?? null, 'MW');
    $('demand-caption').textContent = last ? `Observación: ${stampLabel(last.timestamp)} · neta` : 'Sin demanda verificada';
    chart('demand-chart', demand.series, 'Demanda neta SIN', r => time(r.timestamp));
    table('demand-table', ['Observación (CDMX)', 'MW'], demand.series.map(r => [stampLabel(r.timestamp), number(r.value)]), 'Capturas oficiales; no se interpolan intervalos');
    $('market').textContent = `${dataset.pml.market} · SIN`;
    $('node-select').replaceChildren(...dataset.pml.nodes.map(node => { const option = document.createElement('option'); option.value = node.id; option.textContent = `${node.name || node.id} · ${node.id}`; return option; }));
    $('node-select').disabled = !dataset.pml.nodes.length;
    renderPml();
    const generation = dataset.generation;
    const total = generation.items.reduce((sum, row) => sum + row.value, 0);
    metric('generation-value', generation.items.length ? total / 1000000 : null, 'TWh');
    if (generation.items.length) $('generation-value').firstChild.textContent = `${(total / 1000000).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})} `;
    $('generation-caption').textContent = generation.items.length ? `Mes de operación: ${generation.period} · ${generation.liquidation}` : 'Sin generación verificada';
    $('generation-bars').replaceChildren();
    generation.items.forEach(row => {
      const percent = total ? row.value / total * 100 : 0;
      const div = document.createElement('div'); div.className = 'bar-row';
      const label = document.createElement('div'); label.className = 'bar-label';
      const name = document.createElement('span'); name.textContent = row.technology;
      const value = document.createElement('span'); value.textContent = `${number(row.value)} MWh · ${percent.toFixed(1)}%`;
      label.append(name, value);
      const track = document.createElement('div'); track.className = 'bar-track'; track.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('div'); fill.className = 'bar-fill'; fill.style.width = `${percent}%`; track.append(fill); div.append(label, track); $('generation-bars').append(div);
    });
    if (!generation.items.length) $('generation-bars').textContent = 'Sin observaciones disponibles.';
    table('generation-table', ['Tecnología', 'MWh', '%'], generation.items.map(r => [r.technology, number(r.value), total ? (r.value / total * 100).toFixed(1) : '0.0']), `Generación liquidada · SEN · ${generation.period ?? 'Sin fecha'}`);
    ['demand','pml','generation'].forEach(sourceInfo);
  }
  async function load() {
    $('dashboard').hidden = true; $('retry').hidden = true;
    $('load-status').textContent = 'Cargando publicaciones de CENACE…';
    try {
      const response = await fetch('data/monitor.json', { cache:'no-store', signal:AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json(); validate(data); dataset = data; render();
      $('dashboard').hidden = false; $('load-status').textContent = `Última ejecución del conector: ${stampLabel(dataset.generated_at)} · Consulta el corte de cada módulo`;
    } catch (error) {
      $('load-status').textContent = 'No se pudieron cargar los datos. Verifica el archivo JSON y abre el sitio mediante HTTP o GitHub Pages.';
      $('retry').hidden = false; console.error('MEM Monitor:', error);
    }
  }
  $('node-select').addEventListener('change', renderPml);
  $('retry').addEventListener('click', load);
  setInterval(() => { if (dataset && !$('dashboard').hidden) ['demand','pml','generation'].forEach(sourceInfo); }, 60000);
  load();
})();
