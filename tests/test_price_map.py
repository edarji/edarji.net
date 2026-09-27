import json
import sys
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'pipeline'))
from build_price_map import catalog,prices,SELECTED
class MapTests(unittest.TestCase):
 def test_catalog_location_and_voltage(self):
  nodes=catalog((ROOT/'pipeline/map-source/catalog.xlsx').read_bytes())
  for key in SELECTED:self.assertEqual(nodes[key]['voltage'],400)
  self.assertEqual(nodes['06ESC-400']['municipality'],'GENERAL ESCOBEDO')
  self.assertEqual(nodes['03SAU-400']['state_code'],'22')
  self.assertEqual(nodes['08RMV-400']['state_code'],'31')
 def test_reports_join_and_full_hours(self):
  data={'date':'2026-09-27','reports':[{'system':'SIN','nodes':2458},{'system':'BCA','nodes':121},{'system':'BCS','nodes':31}]}
  seen=set()
  for report in data['reports']:
   system=report['system'];rows,_=prices((ROOT/f'pipeline/map-source/{system}.zip').read_bytes(),system,data['date'])
   self.assertEqual(len(rows),report['nodes'])
   for key,values in rows.items():
    self.assertEqual(len(values),24);self.assertNotIn(key,seen);seen.add(key)
  self.assertEqual(len(seen),2610)
 def test_wrong_date_rejected(self):
  with self.assertRaises(ValueError):prices((ROOT/'pipeline/map-source/SIN.zip').read_bytes(),'SIN','2000-01-01')
if __name__=='__main__':unittest.main()
