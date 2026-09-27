"""Download latest common MDA daily report (SIN/BCA/BCS) and join official node locations."""
import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
from urllib.parse import quote, urljoin
import xml.etree.ElementTree as ET
import zipfile
from fetch_official import ROOT, ZONE, Page, fetch, atomic_json, number

CATALOG_URL='https://www.cenace.gob.mx/Paginas/SIM/NodosP.aspx'
REPORT_URL='https://www.cenace.gob.mx/Paginas/SIM/Reportes/PreEnerServConMDA.aspx'
GEO_URL='https://gaia.inegi.org.mx/wscatgeo/v2/geo/mgee/'
SELECTED=['06ESC-400','03SAU-400','08RMV-400']
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def catalog(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        strings=[''.join(v.itertext()) for v in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rows=ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:row',NS)
        def cells(row):
            result={}
            for c in row:
                v=c.find('s:v',NS)
                result[re.sub(r'\d','',c.attrib['r'])]=strings[int(v.text)] if c.attrib.get('t')=='s' else (v.text if v is not None else '')
            return result
        h=cells(rows[1])
        if h.get('D')!='CLAVE' or h.get('O')!='CLAVE DE ENTIDAD FEDERATIVA (INEGI)' or h.get('R')!='MUNICIPIO (INEGI)':
            raise ValueError('Cambió el catálogo de nodos')
        result={}
        for row in rows[2:]:
            r=cells(row);key=r.get('D','')
            if not key or r.get('A') not in ['SIN','BCA','BCS']:continue
            if key in result:raise ValueError('Nodo duplicado')
            state=r.get('O','');municipality=r.get('Q','')
            result[key]={'id':key,'name':r['E'],'system':r['A'],'voltage':number(r['F']),
                'state_code':f'{int(state):02}' if state.isdigit() and 1<=int(state)<=32 else None,
                'state':r.get('P',''),'municipality':r.get('R',''),
                'municipality_code':f'{int(municipality):03}' if municipality.isdigit() else None,'zone':r.get('C','')}
        if len(result)<100:raise ValueError('Catálogo incompleto')
        return result


def prices(raw,system,day):
    output={}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names=[n for n in z.namelist() if n.endswith('.csv')]
        if len(names)!=1 or f' {system} MDA Dia {day} ' not in names[0]:raise ValueError('Reporte inesperado')
        text=z.read(names[0]).decode('utf-8-sig')
    rows=list(csv.reader(io.StringIO(text)))
    index=next(i for i,r in enumerate(rows) if r and r[0].strip()=='Hora')
    if 'Precio marginal local ($/MWh)' not in [x.strip() for x in rows[index]]:raise ValueError('Unidad incompatible')
    for row in rows[index+1:]:
        if not row:continue
        hour=int(row[0]);key=row[1].strip()
        if not 1<=hour<=24:raise ValueError('Hora no compatible')
        values=output.setdefault(key,[None]*24)
        if values[hour-1] is not None:raise ValueError('Hora duplicada')
        values[hour-1]=number(row[2],False)
    if not output or any(any(x is None for x in values) for values in output.values()):raise ValueError('Serie incompleta')
    publication=next((r[0] for r in rows[:index] if r and 'creado el' in r[0]),'')
    return output,publication


def simplify_ring(points,tolerance=.014):
    # Ramer–Douglas–Peucker in geographical degrees, visualization only.
    def simplify(ps):
        if len(ps)<3:return ps
        a,b=ps[0],ps[-1];dx=b[0]-a[0];dy=b[1]-a[1];den=dx*dx+dy*dy
        best,index=0,0
        for i,p in enumerate(ps[1:-1],1):
            t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)) if den else 0
            dist=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2
            if dist>best:best,index=dist,i
        if best>tolerance*tolerance:return simplify(ps[:index+1])[:-1]+simplify(ps[index:])
        return [ps[0],ps[-1]]
    ring=simplify(points)
    return [[round(x,4),round(y,4)] for x,y,*_ in (ring if len(ring)>=4 else points)]


def main():
    now=datetime.now(timezone.utc).isoformat()
    cache=ROOT/'pipeline/map-source';cache.mkdir(exist_ok=True)
    page_raw=fetch(CATALOG_URL);(cache/'catalog-page.html').write_bytes(page_raw)
    links=re.findall(r'href="([^"]+\.xlsx)"',page_raw.decode('utf-8-sig'))
    if not links:raise ValueError('Catálogo no encontrado')
    catalog_url=urljoin(CATALOG_URL,quote(links[0],safe='/'))
    raw=fetch(catalog_url);(cache/'catalog.xlsx').write_bytes(raw);nodes=catalog(raw)
    report_raw=fetch(REPORT_URL);(cache/'report-page.html').write_bytes(report_raw)
    html=report_raw.decode('utf-8-sig')
    dates=dict(re.findall(r'value="(SIN|BCA|BCS)"[^>]*MAX_FECHA_DATOS="([^"]+)"',html))
    if set(dates)!={'SIN','BCA','BCS'}:raise ValueError('Fechas máximas no disponibles')
    parsed={k:datetime.strptime(v,'%d/%m/%Y').date() for k,v in dates.items()}
    day=min(datetime.now(ZONE).date(), *parsed.values());day_text=day.strftime('%d/%m/%Y')
    records=[];reports=[]
    for system in ['SIN','BCA','BCS']:
        form=Page();form.feed(html)
        form.fields.update({'ctl00$ContentPlaceHolder1$ddlReporte':'359,322','ctl00$ContentPlaceHolder1$ddlPeriodicidad':'D','ctl00$ContentPlaceHolder1$ddlSistema':system,
            'ctl00$ContentPlaceHolder1$btnDescargarZIP':'Descargar ZIP','ctl00$ContentPlaceHolder1$txtPeriodo':f'{day_text}-{day_text}',
            'ctl00$ContentPlaceHolder1$hdfStartDateSelected':day_text,'ctl00$ContentPlaceHolder1$hdfEndDateSelected':day_text})
        raw=fetch(REPORT_URL,form.fields);(cache/f'{system}.zip').write_bytes(raw)
        values,published=prices(raw,system,day.isoformat())
        for key,pml in values.items():
            n=nodes.get(key)
            if n and n['system']!=system:raise ValueError('Sistema de nodo no coincide')
            records.append({**(n or {'id':key,'name':key,'system':system,'voltage':None,'state_code':None,'state':'','municipality':'','zone':''}), 'pml':pml})
        reports.append({'system':system,'published':published,'latest_available_date':parsed[system].isoformat(),'nodes':len(values)})
        print(system,len(values),day,flush=True)
    geo_path=ROOT/'mem-monitor/data/mexico-states.json'
    if not geo_path.exists():
        raw=fetch(GEO_URL);(cache/'states-raw.json').write_bytes(raw);geo=json.loads(raw)
        features=[]
        for f in geo['features']:
            g=f['geometry']
            polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
            features.append({'type':'Feature','properties':{'code':f['properties']['cve_ent'],'name':f['properties']['nomgeo']},'geometry':{'type':'MultiPolygon','coordinates':[[simplify_ring(ring) for ring in poly] for poly in polys]}})
        if len(features)!=32:raise ValueError('Cartografía estatal incompleta')
        atomic_json(geo_path,{'type':'FeatureCollection','source':GEO_URL,'metadata':geo.get('metadatos'), 'features':features})
    payload={'schema_version':1,'market':'MDA','unit':'MXN/MWh','date':day.isoformat(),'fetched_at':now,'default_hour':24,
        'catalog_url':catalog_url,'catalog_version':re.search(r'v(\d{4}-\d{2}-\d{2})',links[0]).group(1),
        'source_url':REPORT_URL,'location_precision':'state_municipality','reports':reports,'nodes':records,
        'unlocated_nodes':sum(n['state_code'] is None for n in records)}
    atomic_json(ROOT/'mem-monitor/data/price-map.json',payload)
    # Feed the overview using the user's chosen 400 kV nodes from the same verified publication.
    overview_path=ROOT/'mem-monitor/data/monitor.json'
    overview=json.loads(overview_path.read_text())
    chosen=[]
    for key in SELECTED:
        n=next(n for n in records if n['id']==key)
        if n['voltage']!=400:raise ValueError('Nodo seleccionado no es de 400 kV')
        chosen.append({'id':key,'name':n['name'],'municipality':n['municipality'],'state':n['state'],'voltage':400,'series':[{'hour':h,'value':v} for h,v in enumerate(n['pml'],1)]})
    overview['pml'].update({'nodes':chosen,'period':day.isoformat(),'status':'official','fetched_at':now,'last_attempt_at':now,'error':None,'source':{'name':'CENACE · Reporte horario MDA','url':REPORT_URL}})
    overview['pml'].pop('request_url',None)
    atomic_json(overview_path,overview)
    from hashlib import sha256
    atomic_json(cache/'manifest.json',{'fetched_at':now,'sources':[CATALOG_URL,catalog_url,REPORT_URL,GEO_URL], 'sha256':{p.name:sha256(p.read_bytes()).hexdigest() for p in cache.iterdir() if p.is_file() and p.name!='manifest.json'}})
    print(f'Mapa: {len(records)} nodos; {payload["unlocated_nodes"]} sin entidad verificada')

if __name__=='__main__':main()
