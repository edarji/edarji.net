import copy
import csv
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import tempfile
import subprocess
from datetime import date
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pipeline'))
import fetch_official
from fetch_official import parse_demand, parse_generation, parse_pml, number
ROOT = Path(__file__).resolve().parents[1]
RAW = sorted((ROOT/'pipeline/raw').glob('*/manifest.json'))[-1].parent

class OfficialDataTests(unittest.TestCase):
    def test_demand_neta_and_timestamp(self):
        raw = (RAW/'demand.html').read_text()
        row = parse_demand(raw)
        self.assertGreater(row['value'], 0)
        self.assertTrue(row['timestamp'].endswith('-06:00'))
        with self.assertRaises(KeyError):
            parse_demand(raw.replace('ContentPlaceHolder1_demandaNACNeta', 'removed'))

    def test_pml_complete_negative_and_duplicates(self):
        data = json.loads((RAW/'pml.json').read_text())
        operation = date.fromisoformat(data['Resultados'][0]['Valores'][0]['fecha'])
        nodes = [r['clv_nodo'] for r in data['Resultados']]
        data['Resultados'][0]['Valores'][0]['pml'] = '-10.25'
        self.assertEqual(parse_pml(data, operation, nodes)[0]['series'][0]['value'], -10.25)
        broken = copy.deepcopy(data)
        broken['Resultados'][0]['Valores'].pop()
        with self.assertRaises(ValueError): parse_pml(broken, operation, nodes)
        broken = copy.deepcopy(data)
        broken['Resultados'][0]['Valores'][1]['hora']='1'
        with self.assertRaises(ValueError): parse_pml(broken, operation, nodes)
        with self.assertRaises(ValueError): parse_pml(data, date(2000,1,1), nodes)

    def test_generation_units_total_and_coverage(self):
        raw=(RAW/'generation.csv').read_text()
        result=parse_generation(raw)
        self.assertEqual(result['rows'],744)
        self.assertEqual(len(result['items']),11)
        rows=list(csv.reader(io.StringIO(raw)))
        start=next(i for i,r in enumerate(rows) if r and r[0]=='Sistema')
        expected=sum(float(v) for r in rows[start+1:] if len(r)>3 for v in r[3:])
        self.assertAlmostEqual(sum(r['value'] for r in result['items']),expected,places=4)
        with self.assertRaises(ValueError): parse_generation(raw.replace('(MWh)','(MW)'))
        with self.assertRaises(ValueError): parse_generation(raw.replace('"SEN"','"SIN"'))
        with self.assertRaises(ValueError): parse_generation(raw[:raw.rfind('\n',0,len(raw)-1)])

    def test_failed_refresh_preserves_valid_data(self):
        snapshot=json.loads((ROOT/'mem-monitor/data/monitor.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);target=root/'monitor.json';target.write_text(json.dumps(snapshot))
            argv=['fetch_official.py','--output',str(target),'--date',snapshot['pml']['period']]
            with patch.object(fetch_official,'ROOT',root), patch.object(sys,'argv',argv), patch.object(fetch_official,'fetch',side_effect=subprocess.CalledProcessError(22,'curl')):
                self.assertEqual(fetch_official.main(),1)
            result=json.loads(target.read_text())
            for key, field in [('demand','series'),('pml','nodes'),('generation','items')]:
                self.assertEqual(result[key]['status'],'stale')
                self.assertEqual(result[key][field],snapshot[key][field])
                self.assertEqual(result[key]['fetched_at'],snapshot[key]['fetched_at'])
            # No prior snapshot: publish unavailable, never synthetic data.
            target.unlink()
            with patch.object(fetch_official,'ROOT',root), patch.object(sys,'argv',argv), patch.object(fetch_official,'fetch',side_effect=subprocess.CalledProcessError(22,'curl')):
                self.assertEqual(fetch_official.main(),1)
            result=json.loads(target.read_text())
            self.assertTrue(all(result[key]['status']=='unavailable' for key in ['demand','pml','generation']))

    def test_invalid_numbers(self):
        for v in ['NaN','Infinity','-1','']:
            with self.assertRaises(ValueError): number(v)

if __name__ == '__main__': unittest.main()
