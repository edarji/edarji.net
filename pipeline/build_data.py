"""Build deterministic, explicitly synthetic data. No external dependencies."""
import argparse
from datetime import datetime, timedelta
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build_demo():
    start = datetime.fromisoformat('2026-01-15T00:00:00-06:00')
    times = [(start + timedelta(hours=h)).isoformat() for h in range(24)]
    demand = [28000, 26700, 25800, 25200, 25000, 26100, 28600, 31200,
              33900, 35600, 37100, 38400, 39300, 39800, 40200, 40500,
              40100, 39600, 40800, 41700, 40200, 37300, 34000, 30900]
    def series(values):
        return [{'timestamp': t, 'value': v} for t, v in zip(times, values)]
    return {
        'schema_version': 1, 'mode': 'demo', 'timezone': 'America/Mexico_City',
        'scenario_date': '2026-01-15',
        'source': {'name': 'Escenario sintético local; sin fuente de mercado', 'url': None},
        'demand': {'system': 'SIN', 'unit': 'MW', 'series': series(demand)},
        'pml': {'market': 'MDA (escenario ilustrativo)', 'unit': 'MXN/MWh', 'nodes': [
            {'id': 'DEMO-A', 'name': 'Nodo demo A', 'series': series([620,580,550,530,520,560,650,780,890,960,1020,1080,1100,1130,1160,1190,1210,1250,1380,1460,1290,1050,850,710])},
            {'id': 'DEMO-B', 'name': 'Nodo demo B', 'series': series([710,670,620,600,590,640,730,880,1010,1090,1140,1180,1250,1310,1330,1380,1420,1480,1630,1720,1490,1210,990,820])}
        ]},
        'generation': {'system': 'SIN', 'unit': 'MW', 'timestamp': times[-1], 'items': [
            {'technology': name, 'value': value} for name, value in [
                ('Ciclo combinado', 18400), ('Hidroeléctrica', 4600), ('Eólica', 3500),
                ('Nuclear', 1500), ('Solar fotovoltaica', 0), ('Otras tecnologías', 2900)]
        ]}
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo', action='store_true', required=True,
                        help='Obligatorio: genera únicamente datos ficticios.')
    parser.add_argument('--output', type=Path, default=ROOT / 'mem-monitor/data/demo.json')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(build_demo(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(args.output)
    print(f'DEMO generado: {args.output}')


if __name__ == '__main__':
    main()
