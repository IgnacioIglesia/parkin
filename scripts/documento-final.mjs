#!/usr/bin/env node
// Arma el documento final en PDF a partir de las secciones de docs/documento-final/:
//   1. Junta los archivos NN-*.md en orden y saca la nota de "Borrador" del principio de cada uno.
//   2. Si falta una sección de las que pide la letra, deja una página que avisa que está pendiente.
//   3. Agrega la portada (con el formato de la preentrega), el índice y los anexos: los archivos
//      09-*.md en adelante, o docs/uso-ia.md completo si no hay ninguno.
//   4. Genera un HTML que dibuja el Markdown y los diagramas Mermaid, y lo imprime con Chrome.
//
// Uso:
//   node scripts/documento-final.mjs
//   FECHA=15/11/2026 node scripts/documento-final.mjs
//
// Salida: docs/documento-final/salida/parkin-documento-final.pdf (y el .html, para revisarlo).
// Necesita Google Chrome y conexión a internet (marked y mermaid se cargan desde jsDelivr).
// Variables: CHROME (ruta al ejecutable), FECHA (la de la portada; por defecto, hoy).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SECCIONES = join(RAIZ, 'docs', 'documento-final');
const SALIDA = join(SECCIONES, 'salida');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FECHA = process.env.FECHA ?? new Date().toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Las secciones que pide la letra, en orden. Si falta un archivo, se deja un aviso en su lugar.
const ESPERADAS = [
  ['01', 'Introducción'], ['02', 'Diseño'], ['03', 'Tecnologías'], ['04', 'Comunicación'],
  ['05', 'Producto'], ['06', 'Observabilidad'], ['07', 'Conclusión'], ['08', 'Referencias'],
];

// Saca la nota "> Borrador ..." que va debajo del título: es para el equipo, no para el informe.
function sinNotaDeBorrador(md) {
  return md.replace(/^(# .+\n+)(> .*\n)+\n?/, '$1');
}

function secciones() {
  const archivos = readdirSync(SECCIONES).filter((a) => /^\d\d-.+\.md$/.test(a)).sort();
  const pendientes = [];
  const textos = ESPERADAS.map(([numero, titulo]) => {
    const archivo = archivos.find((a) => a.startsWith(`${numero}-`));
    if (!archivo) {
      pendientes.push(titulo);
      return `# ${titulo}\n\n<p class="pendiente">Sección pendiente: todavía no está en docs/documento-final/.</p>\n`;
    }
    return sinNotaDeBorrador(readFileSync(join(SECCIONES, archivo), 'utf8'));
  });
  // Lo que viene después de las secciones de la letra (09-anexo-..., etc.) va como anexo.
  const anexos = archivos
    .filter((a) => !ESPERADAS.some(([numero]) => a.startsWith(`${numero}-`)))
    .map((a) => sinNotaDeBorrador(readFileSync(join(SECCIONES, a), 'utf8')));
  return { textos, pendientes, anexos };
}

// Si no hay un anexo propio del documento, va docs/uso-ia.md completo: es el registro de
// decisiones que pide el punto 9 de la letra.
function anexoUsoIa() {
  const md = readFileSync(join(RAIZ, 'docs', 'uso-ia.md'), 'utf8')
    .replace(/^# .+\n/, '# Anexo: registro del uso de inteligencia artificial\n')
    .replace(/^La letra exige.*\n/m, '')
    .replace(/^_Borrador.*_\n/m, '');
  return md;
}

const PORTADA = `
<section class="portada">
  <img class="logo" src="recursos/logo-um.png" alt="Universidad de Montevideo">
  <div class="titulo">PROYECTO DE SISTEMAS<br>DISTRIBUIDOS</div>
  <div class="subtitulo">parkIN: plataforma distribuida de alquiler de cocheras</div>
  <div class="dato">Asignatura: Sistemas Distribuidos</div>
  <div class="dato">Docentes: Daniel Canoniero, Josefina Gallinal</div>
  <div class="dato">Universidad de Montevideo</div>
  <div class="dato">Fecha: ${FECHA}</div>
  <div class="autores">Martina Berrutti, Ignacio Iglesia, Romina Lubniski y Diego Marin</div>
</section>`;

const ESTILOS = `
@page { size: A4; margin: 22mm 20mm 20mm 20mm;
  @bottom-left { content: "Sistemas Distribuidos - Universidad de Montevideo"; font: 9pt "Times New Roman", serif; color: #444; }
  @bottom-right { content: counter(page); font: 9pt "Times New Roman", serif; color: #444; } }
@page :first { @bottom-left { content: none; } @bottom-right { content: none; } }
body { font: 11pt/1.45 "Times New Roman", Times, serif; color: #111; margin: 0; }
.portada { height: 250mm; display: flex; flex-direction: column; align-items: center; text-align: center; page-break-after: always; }
.portada .logo { align-self: flex-start; margin-right: auto; width: 62mm; }
.anexo td:first-child, .anexo td:nth-child(2) { white-space: nowrap; }
.portada .titulo { margin-top: 75mm; font-size: 30pt; line-height: 1.25; }
.portada .subtitulo { margin: 8mm 0 12mm; font-size: 14pt; color: #333; }
.portada .dato { font-size: 13pt; color: #666; margin: 2.5mm 0; }
.portada .autores { margin-top: auto; font-size: 13pt; }
.indice { page-break-after: always; }
.indice h1 { counter-increment: none; }
.indice h1::before { content: none; }
.indice ol { list-style: none; padding-left: 0; }
.indice li { margin: 0.8mm 0; font-size: 10.5pt; }
.indice ol ol { padding-left: 7mm; }
.indice ol ol li { margin: 0.2mm 0; font-size: 9pt; line-height: 1.25; }
.indice a { color: #111; text-decoration: none; }
body { counter-reset: seccion; }
.seccion { page-break-before: always; counter-reset: sub; }
.seccion > h1 { counter-increment: seccion; }
.seccion > h1::before { content: counter(seccion) ". "; }
.seccion > h2 { counter-increment: sub; }
.seccion > h2::before { content: counter(seccion) "." counter(sub) " "; }
.seccion.sin-numero > h1::before, .seccion.sin-numero > h2::before { content: none; }
h1 { font-size: 18pt; margin: 0 0 5mm; color: #0b4a8b; }
h2 { font-size: 14pt; margin: 7mm 0 3mm; color: #0b4a8b; page-break-after: avoid; }
h3 { font-size: 12pt; margin: 5mm 0 2mm; page-break-after: avoid; }
p, li { text-align: justify; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 9pt; line-height: 1.3; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #bbb; padding: 1.5mm 2mm; vertical-align: top; text-align: left; }
th { background: #eef2f7; }
code { font: 9pt Menlo, monospace; background: #f3f3f3; padding: 0 1mm; border-radius: 1mm; }
pre { background: #f6f6f6; padding: 3mm; font-size: 8.5pt; overflow: hidden; white-space: pre-wrap; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
img { max-width: 100%; max-height: 120mm; display: block; margin: 3mm auto; page-break-inside: avoid; }
.figura { page-break-inside: avoid; break-inside: avoid; margin: 3mm 0 4mm; }
.leyenda { text-align: center; font-size: 9pt; color: #555; margin-top: -1mm; }
.mermaid { text-align: center; margin: 4mm 0; page-break-inside: avoid; }
.mermaid svg { max-width: 100%; max-height: 150mm; }
blockquote { margin: 3mm 0; padding: 1mm 4mm; border-left: 3px solid #bbb; color: #444; }
.pendiente { padding: 6mm; border: 2px dashed #c00; color: #c00; text-align: center; }
`;

// En el navegador: dibuja el Markdown, numera los títulos, arma el índice y los diagramas,
// y recién ahí marca la página como lista para que Chrome la imprima.
const SCRIPT_CLIENTE = `
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs';

const secciones = JSON.parse(document.getElementById('secciones').textContent);
const cuerpo = document.getElementById('cuerpo');
secciones.forEach((md, i) => {
  const s = document.createElement('section');
  s.className = 'seccion' + (/^# (Referencias|Anexo)/.test(md) ? ' sin-numero' : '') + (/^# Anexo/.test(md) ? ' anexo' : '');
  s.innerHTML = marked.parse(md);
  s.querySelectorAll('h1, h2').forEach((h, j) => {
    h.textContent = h.textContent.replace(/^\\d+\\.\\s+/, '');
    h.id = 's' + i + '-' + j;
  });
  // El texto alternativo de cada captura se muestra como leyenda debajo.
  // Cada imagen va en una figura con su leyenda, para que no queden en páginas distintas.
  s.querySelectorAll('img').forEach((img) => {
    const figura = document.createElement('div');
    figura.className = 'figura';
    img.replaceWith(figura);
    figura.append(img);
    if (!img.alt) return;
    const leyenda = document.createElement('div');
    leyenda.className = 'leyenda';
    leyenda.textContent = img.alt;
    figura.append(leyenda);
  });
  s.querySelectorAll('pre code.language-mermaid').forEach((c) => {
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = c.textContent;
    c.parentElement.replaceWith(div);
  });
  cuerpo.append(s);
});

const indice = document.getElementById('lista-indice');
let n = 0;
document.querySelectorAll('.seccion').forEach((s) => {
  const h1 = s.querySelector('h1');
  const numerada = !s.classList.contains('sin-numero');
  if (numerada) n++;
  const li = document.createElement('li');
  li.innerHTML = '<a href="#' + h1.id + '">' + (numerada ? n + '. ' : '') + h1.textContent + '</a>';
  const subs = [...s.querySelectorAll(':scope > h2')];
  if (numerada && subs.length) {
    const ol = document.createElement('ol');
    subs.forEach((h2, k) => {
      ol.insertAdjacentHTML('beforeend', '<li><a href="#' + h2.id + '">' + n + '.' + (k + 1) + ' ' + h2.textContent + '</a></li>');
    });
    li.append(ol);
  }
  indice.append(li);
});

// De a uno y con id propio: dibujados juntos, los nodos de un diagrama se mezclaban con los de otro.
mermaid.initialize({ startOnLoad: false, theme: 'neutral', flowchart: { htmlLabels: false } });
let numero = 0;
for (const div of document.querySelectorAll('.mermaid')) {
  const { svg } = await mermaid.render('diagrama-' + numero++, div.textContent);
  div.innerHTML = svg;
}
await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
document.title = 'listo';
`;

function html(textos) {
  const base = pathToFileURL(SECCIONES + '/').href;
  // "</script" dentro del JSON cerraría el bloque antes de tiempo.
  const json = JSON.stringify(textos).replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><base href="${base}">
<title>parkIN - Documento final</title><style>${ESTILOS}</style></head>
<body>
${PORTADA}
<section class="indice"><h1>Índice</h1><ol id="lista-indice"></ol></section>
<main id="cuerpo"></main>
<script type="application/json" id="secciones">${json}</script>
<script type="module">${SCRIPT_CLIENTE}</script>
</body></html>`;
}

if (!existsSync(CHROME)) {
  console.error(`No se encontró Chrome en ${CHROME}. Indicá la ruta con CHROME=...`);
  process.exit(1);
}

const { textos, pendientes, anexos } = secciones();
textos.push(...(anexos.length ? anexos : [anexoUsoIa()]));
mkdirSync(SALIDA, { recursive: true });
const archivoHtml = join(SALIDA, 'parkin-documento-final.html');
const archivoPdf = join(SALIDA, 'parkin-documento-final.pdf');
writeFileSync(archivoHtml, html(textos));

execFileSync(CHROME, [
  '--headless', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files',
  '--virtual-time-budget=30000', '--run-all-compositor-stages-before-draw',
  `--print-to-pdf=${archivoPdf}`, pathToFileURL(archivoHtml).href,
], { stdio: 'ignore' });

console.log(`PDF: ${archivoPdf}`);
if (pendientes.length) console.log(`Secciones pendientes (quedan marcadas en el PDF): ${pendientes.join(', ')}.`);
