(() => {
  'use strict';
  const $=id=>document.getElementById(id), ns='http://www.w3.org/2000/svg';
  const format=value=>value.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
  let data,geo,selected=null,page=0,paths=new Map();
  const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const colors=[[23,59,115],[76,148,181],[191,220,230],[231,177,133],[196,91,85]];
  function color(value,min,max) {
    if(value===null)return '#26384b';
    const position=max===min?2:Math.max(0,Math.min(4,(value-min)/(max-min)*4));
    const i=Math.min(3,Math.floor(position)),f=position-i;
    return `rgb(${colors[i].map((c,k)=>Math.round(c*(1-f)+colors[i+1][k]*f)).join(',')})`;
  }
  function filtered(){return data.nodes.filter(n=>($('system-filter').value==='all'||n.system===$('system-filter').value)&&($('voltage-filter').value==='all'||n.voltage===400));}
  function validate(d,g) {
    if(d.schema_version!==1||d.market!=='MDA'||d.unit!=='MXN/MWh'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.fetched_at))||!Array.isArray(d.nodes)||!d.nodes.length||g.features?.length!==32)throw Error('Formato incompatible');
    const ids=new Set();
    d.nodes.forEach(n=>{if(ids.has(n.id)||typeof n.id!=='string'||!['SIN','BCA','BCS'].includes(n.system)||!Array.isArray(n.pml)||n.pml.length!==24||n.pml.some(v=>typeof v!=='number'||!Number.isFinite(v))||!(n.state_code===null||/^(0[1-9]|[12]\d|3[0-2])$/.test(n.state_code)))throw Error('Nodo inválido');ids.add(n.id);});
    if(!Array.isArray(d.reports)||d.reports.length!==3)throw Error('Cobertura no reconocida');
    g.features.forEach(f=>{if(f.geometry.type!=='MultiPolygon'||!f.properties.code)throw Error('Geometría inválida');});
  }
  function project([lon,lat]) {return [40+(lon+118.5)/32.5*920,35+(33.5-lat)/20*570];}
  function drawMap() {
    const svg=$('mexico-map');svg.replaceChildren();paths=new Map();
    geo.features.forEach(f=>{
      const path=document.createElementNS(ns,'path');
      path.setAttribute('d',f.geometry.coordinates.map(poly=>poly.map(ring=>ring.map((p,i)=>`${i?'L':'M'}${project(p).map(n=>n.toFixed(1)).join(',')}`).join(' ')+'Z').join(' ')).join(' '));
      path.setAttribute('fill-rule','evenodd');path.setAttribute('class','state');path.setAttribute('tabindex','0');path.setAttribute('role','button');path.dataset.code=f.properties.code;
      const title=document.createElementNS(ns,'title');path.append(title);
      const select=()=>{selected=f.properties.code;page=0;render();};
      path.addEventListener('click',select);path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
      svg.append(path);paths.set(f.properties.code,{path,title,name:f.properties.name});
    });
    for(const [label,x,y] of [['OCÉANO PACÍFICO',195,470],['GOLFO DE MÉXICO',720,300]]){
      const el=document.createElementNS(ns,'text');el.setAttribute('x',x);el.setAttribute('y',y);el.textContent=label;svg.append(el);
    }
  }
  function render(){
    const hour=Number($('hour-filter').value),nodes=filtered(),aggregates=new Map();
    nodes.forEach(n=>{if(n.state_code){const v=aggregates.get(n.state_code)||[];v.push(n.pml[hour-1]);aggregates.set(n.state_code,v);}});
    const means=new Map([...aggregates].map(([k,v])=>[k,v.reduce((a,b)=>a+b,0)/v.length]));
    const values=[...means.values()],min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):0;
    $('hour-value').textContent=String(hour).padStart(2,'0');
    $('map-period').textContent=`MDA / DÍA DE OPERACIÓN ${data.date} / HORA ${hour} / MXN/MWh`;
    $('legend-min').textContent=values.length?format(min):'—';$('legend-max').textContent=values.length?format(max):'—';
    $('map-coverage').textContent=`${nodes.length.toLocaleString('es-MX')} nodos con PML · ${nodes.filter(n=>n.state_code).length.toLocaleString('es-MX')} ubicados por entidad · ${nodes.filter(n=>!n.state_code).length} sin ubicación verificable · ${means.size}/32 entidades con datos. Escala recalculada para la hora y filtros elegidos.`;
    paths.forEach(({path,title,name},code)=>{const value=means.get(code)??null;path.setAttribute('fill',color(value,min,max));path.classList.toggle('selected',code===selected);const label=`${name}: ${value===null?'sin datos':format(value)+' MXN/MWh; '+aggregates.get(code).length+' nodos'}`;title.textContent=label;path.setAttribute('aria-label',label);path.setAttribute('aria-pressed',String(code===selected));});
    const area=selected?nodes.filter(n=>n.state_code===selected):nodes.filter(n=>n.state_code);
    const mean=area.length?area.reduce((sum,n)=>sum+n.pml[hour-1],0)/area.length:null;
    $('selected-state').textContent=selected?paths.get(selected).name:'México';
    $('state-price').textContent=mean===null?'—':format(mean);
    $('state-summary').textContent=`MXN/MWh · promedio de ${area.length} nodos ubicados · hora ${hour}. Selecciona una entidad en el mapa.`;
    $('clear-state').disabled=!selected;
    const age=(Date.now()-Date.parse(data.fetched_at))/3600000;
    $('map-status').textContent=age>30?'DESCARGA SIN ACTUALIZAR · consulta la fecha y la fuente oficial.':`CENACE · última descarga disponible · ${data.date}`;
    renderTable(nodes,hour);
  }
  function renderTable(nodes,hour){
    const query=normalize($('node-search').value);
    const rows=nodes.filter(n=>(!selected||n.state_code===selected)&&normalize(`${n.id} ${n.name} ${n.municipality} ${n.state}`).includes(query)).sort((a,b)=>b.pml[hour-1]-a.pml[hour-1]||a.id.localeCompare(b.id));
    const pages=Math.max(1,Math.ceil(rows.length/40));page=Math.min(page,pages-1);
    $('node-rows').replaceChildren();
    rows.slice(page*40,(page+1)*40).forEach(n=>{const tr=document.createElement('tr');
      for(const [main,sub] of [[n.id,n.name],[n.municipality||'Sin municipio',n.state||'Sin entidad'],[n.system,''],[n.voltage??'—',''],[format(n.pml[hour-1]),'']]){const td=document.createElement('td');td.textContent=main;if(sub){const small=document.createElement('small');small.textContent=sub;td.append(small);}tr.append(td);}
      $('node-rows').append(tr);
    });
    $('table-caption').textContent=`${rows.length} resultados · ${data.date} · hora ${hour} · orden por PML descendente`;
    $('node-count').textContent=`${rows.length} NODOS`;$('page-label').textContent=`${page+1} / ${pages}`;$('previous-page').disabled=page===0;$('next-page').disabled=page===pages-1;
  }
  async function load(){
    $('map-content').hidden=true;$('map-retry').hidden=true;$('map-status').textContent='Cargando mapa y precios oficiales…';
    try{
      const [d,g]=await Promise.all(['data/price-map.json','data/mexico-states.json'].map(async url=>{const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(r.status);return r.json();}));
      validate(d,g);data=d;geo=g;selected=null;page=0;drawMap();
      $('map-sources').replaceChildren();
      for(const [label,url] of [['PML horarios CENACE',data.source_url],['Catálogo NodosP '+data.catalog_version,data.catalog_url],['Cartografía INEGI',geo.source]]){
        const parsed=new URL(url);if(parsed.protocol!=='https:'||!/(^|\.)(cenace|inegi)\.gob\.mx$/.test(parsed.hostname)&&!/(^|\.)inegi\.org\.mx$/.test(parsed.hostname))throw Error('Fuente inválida');
        const a=document.createElement('a');a.href=url;a.textContent=label;a.target='_blank';a.rel='noreferrer';$('map-sources').append(a,document.createElement('br'));
      }
      $('map-download').textContent='Descarga: '+new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Mexico_City'}).format(new Date(data.fetched_at))+' (CDMX).';
      $('report-details').replaceChildren(...data.reports.map(r=>{const li=document.createElement('li');li.textContent=`${r.system}: ${r.nodes} nodos. Fecha máxima publicada: ${r.latest_available_date}. ${r.published}`;return li;}));
      $('map-content').hidden=false;render();
    }catch(error){$('map-status').textContent='No se pudo cargar o validar el mapa. Reintenta; no se mostrarán precios ficticios.';$('map-retry').hidden=false;console.error('Mapa MEM',error);}
  }
  ['hour-filter','system-filter','voltage-filter','node-search'].forEach(id=>$(id).addEventListener('input',()=>{page=0;if(data)render();}));
  $('clear-state').addEventListener('click',()=>{selected=null;page=0;render();});
  $('previous-page').addEventListener('click',()=>{page--;render();});$('next-page').addEventListener('click',()=>{page++;render();});$('map-retry').addEventListener('click',load);
  setInterval(()=>{if(data&&!$('map-content').hidden)render();},60000);
  load();
})();
