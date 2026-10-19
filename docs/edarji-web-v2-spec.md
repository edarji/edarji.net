# Edarji.net · Especificación editorial v2

Estado: implementado en el PR #1 (`editorial-v2`), aprobado por Eduardo Arriola el 2026-10-19 y fusionado a `main`.

## Origen y aprobación
- La propuesta editorial y de diseño viene de ChatGPT (chat "01 · Edarji.net | Website", proyecto Edarji Web).
- Contenido aprobado por Eduardo Arriola.
- Implementación y pruebas: Claude (Cyborg Lab), 2026-10-19.

## Decisiones adoptadas
1. Nombre público: **Eduardo Arriola**. No se hizo un reemplazo global de `edarji`; los dominios, repos y rutas siguen igual, y la marca Ed ArJi Jazz no cambia.
2. Navegación: Inicio · Mercados · Sobre mí · Contacto, igual en la portada, en `/mercados/` y en `/mem-monitor/`. Proyectos sale del menú, pero el ancla `#intereses` se conserva.
3. Sección del monitor en `https://edarji.net/mercados/`, como página estática sin subdominio.
4. Bloque destacado del Electricity Markets Monitor justo después del hero. PML Explorer aparece como "En desarrollo".
5. `/mem-monitor/` se conserva y se presenta como "versión anterior", no como el nuevo Explorer.
6. Las tarjetas del hero apuntan a Mercados, Sobre mí y Ed ArJi Jazz (edarji.mx).
7. Contacto: solo el enlace a GitHub (github.com/edarji). No se publican correo, LinkedIn ni formulario.
8. Publicación: se añade `mercados` a la copia hacia `_site/` en `publish.yml`, porque sin eso la carpeta no se publicaría. `CNAME`, el DNS y el dominio no se tocaron.
9. Accesibilidad: contraste mínimo de 4.5:1 en el texto normal y foco visible. Las tarjetas sin destino ya no son enfocables.
10. No se instaló ningún analytics; el sitio no tenía ninguno.

## Fuera de alcance
- Las páginas `/sobre-mi` y `/contacto`, un blog, y la integración de Streamlit o del PML Explorer bajo `/mercados`.
- El sitio edarji.mx y su configuración.
