# MEM Monitor · Blue Session

Diseño inspirado en el ambiente de Kind of Blue: azul noche, azul humo, cifras
monoespaciadas y acento editorial serif. Sin imágenes ni marcas de terceros.
El cambio visual se limita al monitor y conserva la navegación del sitio.

## Conexión oficial v2

Los tres paneles consumen publicaciones reales de CENACE, no datos demo:

| Módulo | Fuente | Cobertura / unidad | Corte |
| --- | --- | --- | --- |
| Demanda neta | [Gráfica de demanda](https://www.cenace.gob.mx/graficademanda.aspx) | SIN / MW | Observación fechada publicada en la página |
| PML | [Manual SW-PML](https://www.cenace.gob.mx/DocsMEM/2020-01-14%20Manual%20T%C3%A9cnico%20SW-PML.pdf) | SIN / MXN/MWh / MDA | Día de operación; horas 1–24 |
| Generación | [Reporte de tecnología](https://www.cenace.gob.mx/Paginas/SIM/Reportes/EnergiaGeneradaTipoTec.aspx) | SEN / MWh | Mes completo y liquidación identificada |

Primera descarga verificada: demanda y PML del 27-09-2026; generación de agosto
2026, liquidación original L0. Las siguientes ejecuciones consultan el día actual
y el reporte de generación disponible en el formulario público.

El nodo inicial `01PLO-115` es la referencia documentada en el manual oficial;
no se presenta como promedio del SIN ni como nodo representativo de México.
Puede configurarse una lista de hasta 20 nodos SIN con `--nodes`.

## Actualizar / probar

Desde la raíz del repositorio, con Python 3.9+ y curl instalado:

```sh
python3 pipeline/fetch_official.py
python3 -m http.server 8000
```

Para un día específico y un nodo:

```sh
python3 pipeline/fetch_official.py --date 2026-09-27 --nodes 01PLO-115
```

Abrir `http://localhost:8000/mem-monitor/`. El navegador **lee el JSON guardado**;
recargar la página no vuelve a consultar CENACE. El estado de antigüedad sí se
recalcula cada minuto. La publicación usa GitHub Actions con ejecución diaria a las 07:17 h de CDMX
(13:17 UTC); GitHub puede retrasar el inicio. Para actualizar GitHub Pages se debe ejecutar el conector e incluir
el JSON actualizado en el despliegue existente.

El generador sintético anterior se conserva para ejercicios; ahora escribe
`mem-monitor/data/demo.json`, separado del JSON oficial. La interfaz v2 rechaza
el esquema demo v1. No existe sustitución automática de datos reales por demo.

## Flujo y trazabilidad

CENACE → Python descarga con curl y TLS verificado → valida y normaliza → escribe
JSON atómicamente → JavaScript valida y dibuja → GitHub Pages sirve archivos.

`pipeline/raw/<fecha UTC>/` conserva las respuestas originales y un manifiesto
con URL, fecha de descarga y SHA-256. No se usan claves ni credenciales.
El manifiesto permite auditar cada descarga. La página de demanda y el formulario
CSV no son APIs versionadas: si cambian, el importador falla de forma explícita.

## Semántica y límites

- **Demanda:** se extrae exclusivamente demanda neta del SIN y la hora publicada,
  interpretada en America/Mexico_City, visible en el monitor. Se conservan las
  capturas del mismo día, sin duplicar timestamps ni interpolar. No es una curva
  horaria retrospectiva. La respuesta gráfica de CENACE investigada contenía
  horas sin fecha verificable y por eso no se utiliza. La demanda es indicativa,
  como advierte la fuente; no se usa como dato de liquidación.
- **PML:** consulta REST pública `SIN/MDA`, valida sistema, mercado, nodos, fecha
  y 24 horas sin duplicados. La cifra principal es el promedio aritmético diario
  de los precios, no ponderado por energía. Se preservan las horas de operación
  1–24 originales, sin inventar equivalencias UTC. Se permiten precios negativos.
  Días con distinto número de horas se rechazan hasta implementar su semántica.
- **Generación:** descarga el primer CSV disponible del formulario oficial,
  conserva liquidación y fecha de publicación, suma los MWh por tecnología del
  mes completo y comprueba cobertura de 24 horas por día. El resumen se muestra
  en TWh; barras y tabla en MWh. **SEN no es SIN.** No se compara esa energía
  mensual con la potencia instantánea de demanda. No se mezclan liquidaciones.
- Se rechazan NaN, infinito, valores negativos de demanda/generación, duplicados,
  unidades/coberturas inesperadas y meses incompletos. No se rellenan faltantes.

## Estados y contrato v2

Raíz: `schema_version: 2`, `mode: official`, `timezone`, `generated_at`.
Cada módulo: `status` (`official`, `stale`, `unavailable`), `period`, `source`,
`unit`, `system`, `fetched_at`, `last_attempt_at`, `stale_after_hours`, `error`.
Demanda: `series[{timestamp,value}]`; PML: `market`, `nodes[{id,name,series[{hour,value}]}]`;
generación: `items[{technology,value}]`, `rows`, `liquidation`, `published_label`.

Una descarga fallida conserva el último módulo válido y marca `stale`.
Para PML solo se reutiliza si fecha y nodos coinciden con la consulta solicitada.
Sin un dato previo compatible, muestra `unavailable` y listas vacías. La ejecución
termina con código 1 si algún módulo falla, aunque guarda los resultados parciales.
Los archivos nunca se escriben parcialmente.

Umbrales editoriales de antigüedad (no compromisos de CENACE): 2 h desde la
observación para demanda, 30 h desde la consulta para PML, 40 días desde la consulta
para generación. La fecha de operación o mes siempre permanece visible; un PML
anterior al día actual se identifica como histórico. Los avisos no prueban que
exista una nueva publicación oficial.

## Archivos

- `../index.html`, `../README.md`: integración y descripción actualizadas.
- `index.html`, `monitor.css`: paneles, fuentes, cobertura y diseño Blue Session.
- `monitor.js`: contrato v2, fechas, estados, gráficos y tablas.
- `data/monitor.json`: último conjunto oficial normalizado.
- `../pipeline/fetch_official.py`: tres importadores, evidencia y recuperación.
- `../pipeline/build_data.py`: generador demo aislado.
- `../tests/test_official.py`, `../tests/monitor.cjs`: pruebas de importación e interfaz.

## Verificación

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node tests/monitor.cjs
```

La prueba de navegador necesita Playwright y servidor local; se puede usar Chrome
instalado con `CHROME_CHANNEL=chrome`. `MONITOR_URL` cambia la URL de prueba.
Las pruebas usan evidencia capturada; incluyen unidades, agregación mensual,
series incompletas, precios negativos, estados de error/antigüedad y móvil 320/390 px.

## Aprendizaje y prompt engineering

JSON es el acuerdo entre Python y la interfaz. El contrato incluye procedencia,
no solo números: fecha observada, descarga, cobertura y unidad son parte del dato.

Prompt útil: “Para cada indicador verifica fuente, unidad, cobertura y corte.
No conviertas MW en MWh ni SEN en SIN sin una transformación justificada. Conserva
el dato original y, si falla una actualización, muestra su antigüedad sin inventar”.

## Mapa de precios y nodos de referencia

La pestaña `mapa.html` presenta un mapa de calor **por entidad**, con cartografía
oficial INEGI (Marco Geoestadístico diciembre 2025) y PML nodales CENACE.
El catálogo vigente se descarga desde la página oficial: incluye entidad y municipio,
no coordenadas exactas del nodo. Por ello no se dibujan puntos ni se interpolan precios.
El color representa promedio aritmético simple de nodos con ubicación verificada,
no un precio publicado por estado ni una tarifa. Gris significa ausencia de datos.

```sh
python3 pipeline/build_price_map.py
```

El conector consulta la fecha máxima del reporte MDA por SIN/BCA/BCS, toma la más
reciente común y descarga tres ZIP diarios completos. La hora inicial 24 es la última
hora de operación del reporte publicado, **no la hora actual ni un precio MTR**.
Se puede elegir cualquiera de las 24 horas, sistema, tensión y estado. La escala
se recalcula con cada cambio de hora/filtros. El directorio permite buscar municipio,
nombre o clave y muestra 40 resultados por página, ordenados por precio descendente.

Descarga inicial: 27-09-2026, 2,610 nodos (SIN 2,458; BCA 121; BCS 31); 9 no tienen
entidad verificable en el cruce de catálogo y se excluyen del color, pero permanecen
consultables. La fecha de publicación de cada sistema se muestra en la página.

`pipeline/build_price_map.py` también actualiza el selector del panorama con:

- `06ESC-400`: Escobedo, General Escobedo, zona de carga Monterrey.
- `03SAU-400`: El Sauz, Pedro Escobedo, Querétaro.
- `08RMV-400`: Riviera Maya-Valladolid, Valladolid, Yucatán.

Son 400 kV verificados en el catálogo v2026-09-23. Los mismos nodos son ahora los
valores predeterminados de `fetch_official.py`.

Archivos añadidos: `mapa.html`, `mapa.js`, `data/price-map.json`,
`data/mexico-states.json`, `../pipeline/build_price_map.py`,
`../tests/map.cjs` y `../tests/test_price_map.py`. Se amplió `monitor.css`.
Las respuestas crudas y su manifiesto SHA-256 están en `pipeline/map-source/`;
la geometría original de 28 MB se conserva localmente e ignora en Git. La versión
simplificada para el navegador no se debe usar para deslindes territoriales.
Si falla una descarga, el mapa previo permanece guardado; la interfaz muestra
un aviso de antigüedad pasadas 30 horas. GitHub Actions ejecuta el conector diariamente y publica los archivos validados.

El emblema `assets/mem-energy.svg` es un diseño original de gota azul asimétrica con
rayo claro. Se usa junto a MEM Monitor y como favicon. No incorpora logotipos,
letras, archivos gráficos ni denominaciones de Luz y Fuerza del Centro o Vitol.

Verificación adicional: `node tests/map.cjs` (mismos requisitos de Playwright),
mapa de 32 entidades, selector horario, filtros, búsquedas, fallos de carga,
selector de 400 kV y ausencia de desbordamiento móvil a 320 y 390 px.

## Publicación diaria

`.github/workflows/publish.yml` ejecuta los conectores a las 07:17 CDMX (13:17 UTC),
también con cada cambio en main o ejecución manual. Usa el día de operación actual
o el último anterior disponible; nunca adelanta el mapa al día siguiente.
La generación continúa siendo el último mes publicado, identificado como tal.
Guarda JSON en el repositorio, evidencia de descarga durante 14 días y despliega
solo HTML/CSS/JS, imágenes y datos públicos. No publica código Python ni pruebas.
Ante fallos de fuentes, conserva datos válidos, muestra sus fechas y marca el workflow
como fallido después del despliegue. Las notificaciones dependen de los ajustes de GitHub.

GitHub Pages debe usar la fuente **GitHub Actions**; el dominio sigue siendo edarji.net.
