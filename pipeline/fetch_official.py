"""Fetch public CENACE observations; normalize without filling missing values.
Requires Python 3.9+ and curl (TLS verification remains enabled).
"""
import argparse
import calendar
import csv
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from html.parser import HTMLParser
import io
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ZONE = ZoneInfo('America/Mexico_City')
DEMAND_URL = 'https://www.cenace.gob.mx/graficademanda.aspx'
GEN_URL = 'https://www.cenace.gob.mx/Paginas/SIM/Reportes/EnergiaGeneradaTipoTec.aspx'
PML_BASE = 'https://ws01.cenace.gob.mx:8082/SWPML/SIM'


def number(value, nonnegative=True):
    result = float(value)
    if not math.isfinite(result) or (nonnegative and result < 0):
        raise ValueError('Valor no finito o fuera de dominio')
    return result


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields, self.texts, self.csv_buttons = {}, {}, []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'span' and attrs.get('id'):
            self.current = attrs['id']
        if tag == 'input' and attrs.get('name'):
            if attrs.get('type') not in ('image', 'submit', 'button'):
                self.fields[attrs['name']] = attrs.get('value', '')
            if attrs.get('src', '').endswith('imgCsv.png'):
                self.csv_buttons.append(attrs['name'])

    def handle_endtag(self, tag):
        if tag == 'span':
            self.current = None

    def handle_data(self, data):
        if self.current:
            self.texts[self.current] = self.texts.get(self.current, '') + data


def parse_demand(html):
    page = Page(); page.feed(html)
    value = page.texts['ContentPlaceHolder1_demandaNACNeta'].strip()
    if not re.fullmatch(r'[\d,]+(?:\.\d+)? MW', value):
        raise ValueError('Unidad/formato de demanda cambiado')
    stamp = page.texts['ContentPlaceHolder1_datetimeNAC'].strip()
    match = re.fullmatch(r'(\d{2}/\d{2}/\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([ap])\.\s*m\.', stamp)
    if not match:
        raise ValueError('Fecha de demanda no reconocida')
    day, hour, minute, second, half = match.groups()
    hour = int(hour)
    if not 1 <= hour <= 12:
        raise ValueError('Hora inválida')
    observed = datetime.strptime(day, '%d/%m/%Y').replace(hour=hour % 12 + (12 if half == 'p' else 0), minute=int(minute), second=int(second), tzinfo=ZONE)
    return {'timestamp': observed.isoformat(), 'value': number(value.removesuffix(' MW').replace(',', ''))}


def parse_pml(payload, operation_date, nodes):
    if payload.get('nombre') != 'PML' or payload.get('sistema') != 'SIN' or payload.get('proceso') != 'MDA' or payload.get('status') != 'OK':
        raise ValueError('Respuesta PML incompatible o sin datos')
    result = []
    for node in payload['Resultados']:
        if node['clv_nodo'] not in nodes:
            raise ValueError('Nodo inesperado')
        rows = []
        for row in node['Valores']:
            hour = int(row['hora'])
            if row['fecha'] != operation_date.isoformat() or not 1 <= hour <= 24:
                raise ValueError('Fecha/hora PML inesperada')
            # Keep CENACE operating hours 1..24, rather than assigning an unverified UTC instant.
            rows.append({'hour': hour, 'value': number(row['pml'], False)})
        rows.sort(key=lambda r: r['hour'])
        if [r['hour'] for r in rows] != list(range(1, 25)):
            raise ValueError('Serie PML incompleta o duplicada')
        result.append({'id': node['clv_nodo'], 'name': {'06ESC-400':'Escobedo · Monterrey', '03SAU-400':'El Sauz · Querétaro', '08RMV-400':'Riviera Maya-Valladolid · Yucatán'}.get(node['clv_nodo'], node['clv_nodo']), 'series': rows})
    if sorted(n['id'] for n in result) != sorted(nodes):
        raise ValueError('Faltan nodos PML')
    return result


def parse_generation(text):
    rows = list(csv.reader(io.StringIO(text)))
    header_at = next(i for i, row in enumerate(rows) if row and row[0].strip() == 'Sistema')
    preamble = ' '.join(' '.join(r) for r in rows[:header_at])
    if '(MWh)' not in preamble or 'Sistema Electrico Nacional' not in preamble:
        raise ValueError('Unidad/cobertura de generación no reconocida')
    headers = [v.strip() for v in rows[header_at]]
    if headers[:3] != ['Sistema', 'Dia', 'Hora'] or len(set(headers)) != len(headers):
        raise ValueError('Columnas de generación incompatibles')
    totals = [Decimal(0) for _ in headers[3:]]
    seen, months = set(), set()
    for row in rows[header_at + 1:]:
        if not row or not any(v.strip() for v in row):
            continue
        if len(row) != len(headers) or row[0] != 'SEN':
            raise ValueError('Fila de generación incompatible')
        day = datetime.strptime(row[1], '%d/%m/%Y').date(); hour = int(row[2])
        if not 1 <= hour <= 24 or (day, hour) in seen:
            raise ValueError('Hora duplicada o incompatible')
        seen.add((day, hour)); months.add((day.year, day.month))
        for i, cell in enumerate(row[3:]):
            number(cell)
            totals[i] += Decimal(cell)
    if len(months) != 1:
        raise ValueError('Más de un mes o sin observaciones')
    year, month = months.pop()
    if len(seen) != calendar.monthrange(year, month)[1] * 24:
        raise ValueError('Mes incompleto; no se agregan valores faltantes')
    liquidation = re.search(r'Proceso de Liquidacion:\s*([^\r\n]+)', preamble)
    published = re.search(r'creado el ([^\r\n]+? hrs\.)', preamble)
    return {'period': f'{year:04}-{month:02}', 'rows': len(seen),
            'liquidation': liquidation.group(1).strip().split('Archivo')[0].strip() if liquidation else 'No especificada',
            'published_label': published.group(1) if published else 'Consultar fuente',
            'items': [{'technology': name, 'value': float(value)} for name, value in zip(headers[3:], totals)]}


def fetch(url, form=None):
    command = ['curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '45', '--retry', '1', '--user-agent', 'edarji.net MEM Monitor (public data)']
    if form is not None:
        command += ['--header', 'Content-Type: application/x-www-form-urlencoded', '--data-binary', '@-']
    return subprocess.run(command + [url], input=urlencode(form).encode() if form is not None else None, capture_output=True, check=True, timeout=100).stdout


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, suffix='.tmp', delete=False, encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False); handle.write('\n')
        temp = Path(handle.name)
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', type=date.fromisoformat, help='Día de operación MDA; por defecto hoy en CDMX')
    parser.add_argument('--nodes', default='06ESC-400,03SAU-400,08RMV-400', help='Nodos SIN, separados por coma; máximo 20')
    parser.add_argument('--output', type=Path, default=ROOT / 'mem-monitor/data/monitor.json')
    args = parser.parse_args()
    nodes = args.nodes.split(',')
    if not 1 <= len(nodes) <= 20 or len(set(nodes)) != len(nodes) or any(not re.fullmatch(r'[A-Z0-9-]+', n) for n in nodes):
        parser.error('Lista de nodos inválida')
    now = datetime.now(timezone.utc)
    day = args.date or now.astimezone(ZONE).date()
    raw_dir = ROOT / 'pipeline/raw' / now.strftime('%Y%m%dT%H%M%SZ'); raw_dir.mkdir(parents=True, exist_ok=True)
    old = json.loads(args.output.read_text()) if args.output.exists() else {}
    if old.get('schema_version') != 2:
        old = {}
    output = {'schema_version': 2, 'mode': 'official', 'timezone': 'America/Mexico_City', 'generated_at': now.isoformat()}
    evidence = []

    def archive(name, content, url):
        (raw_dir / name).write_bytes(content)
        evidence.append({'file': name, 'url': url, 'sha256': sha256(content).hexdigest()})

    def module(key, base, loader):
        try:
            result = loader()
            output[key] = {**base, **result, 'status': 'official', 'fetched_at': now.isoformat(), 'last_attempt_at': now.isoformat(), 'error': None}
            print(f'{key}: fuente oficial descargada')
        except (ValueError, KeyError, StopIteration, TypeError, OSError, subprocess.SubprocessError) as error:
            previous = old.get(key, {})
            compatible = key != 'pml' or (previous.get('period') == day.isoformat() and sorted(n['id'] for n in previous.get('nodes', [])) == sorted(nodes))
            if compatible and previous.get('status') in ('official', 'stale'):
                output[key] = {**previous, 'status': 'stale', 'last_attempt_at': now.isoformat(), 'error': 'Falló la actualización; se conserva el último dato válido.'}
            else:
                output[key] = {**base, 'status': 'unavailable', 'fetched_at': None, 'last_attempt_at': now.isoformat(), 'error': 'Fuente no disponible o formato no reconocido.'}
            print(f'{key}: {output[key]["status"]} ({type(error).__name__})')

    def demand():
        raw = fetch(DEMAND_URL); archive('demand.html', raw, DEMAND_URL)
        row = parse_demand(raw.decode('utf-8-sig'))
        if datetime.fromisoformat(row['timestamp']) > now + timedelta(minutes=5):
            raise ValueError('Fecha de observación futura')
        rows = old.get('demand', {}).get('series', [])
        rows = [r for r in rows if r['timestamp'][:10] == row['timestamp'][:10]]
        by_time = {r['timestamp']: r for r in rows}; by_time[row['timestamp']] = row
        return {'period': row['timestamp'][:10], 'series': sorted(by_time.values(), key=lambda r:r['timestamp'])}
    module('demand', {'system':'SIN','unit':'MW','series':[], 'period':None, 'source':{'name':'CENACE · Demanda neta indicativa','url':DEMAND_URL}, 'stale_after_hours':2}, demand)

    def pml():
        date_path = day.strftime('%Y/%m/%d')
        url = f'{PML_BASE}/SIN/MDA/{",".join(nodes)}/{date_path}/{date_path}/JSON'
        raw = fetch(url); archive('pml.json', raw, url)
        return {'period':day.isoformat(), 'nodes':parse_pml(json.loads(raw), day, nodes), 'request_url':url}
    module('pml', {'system':'SIN','unit':'MXN/MWh','market':'MDA','nodes':[], 'period':day.isoformat(), 'source':{'name':'CENACE · SW-PML','url':'https://www.cenace.gob.mx/DocsMEM/2020-01-14%20Manual%20T%C3%A9cnico%20SW-PML.pdf'}, 'stale_after_hours':30}, pml)

    def generation():
        raw = fetch(GEN_URL); archive('generation-page.html', raw, GEN_URL)
        page = Page(); page.feed(raw.decode('utf-8-sig'))
        if not page.csv_buttons:
            raise ValueError('No se encontró reporte CSV')
        button = page.csv_buttons[0]
        page.fields[button+'.x'] = '5'; page.fields[button+'.y'] = '5'
        raw = fetch(GEN_URL, page.fields); archive('generation.csv', raw, GEN_URL)
        return parse_generation(raw.decode('utf-8-sig'))
    module('generation', {'system':'SEN','unit':'MWh','items':[], 'period':None, 'source':{'name':'CENACE · Generación liquidada mensual','url':GEN_URL}, 'stale_after_hours':24*40}, generation)
    atomic_json(raw_dir/'manifest.json', {'fetched_at':now.isoformat(), 'evidence':evidence})
    atomic_json(args.output, output)
    print(f'JSON guardado: {args.output}')
    return 0 if all(output[k]['status'] == 'official' for k in ('demand','pml','generation')) else 1


if __name__ == '__main__':
    raise SystemExit(main())
