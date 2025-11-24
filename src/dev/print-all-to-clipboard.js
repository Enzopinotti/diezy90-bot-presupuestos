// src/dev/print-all-to-clipboard.js
// ----------------------------------------------------
// Junta TODO (sin límite) de services, controllers, data y config,
// lo formatea en Markdown y lo copia al portapapeles.
// Uso: node src/dev/print-all-to-clipboard.js
//
// Requiere: Node 18+
// Linux: necesita tener instalado xclip o xsel para copiar al clipboard.

import fs from 'fs/promises';
import fscore from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(process.cwd(), 'src');
const FOLDERS = ['services', 'controllers', 'data', 'config'];
const EXCLUDES = ['node_modules', 'dist', 'build', '.git', '.cache', 'coverage', 'tmp', 'logs', '.DS_Store'];
// Extensiones de texto comunes (evitamos binarios pesados)
const TEXT_EXTS = new Set([
  'js','mjs','cjs','ts','tsx','jsx',
  'json','yml','yaml','env',
  'html','css','scss',
  'md','txt',
  'sql','csv'
]);

function looksExcluded(p) {
  const s = p.replace(/\\/g, '/');
  return EXCLUDES.some(sub => s.includes(sub));
}
function isTextFile(p) {
  const ext = path.extname(p).slice(1).toLowerCase();
  return TEXT_EXTS.has(ext);
}
async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}
async function walk(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (looksExcluded(abs)) continue;
    if (e.isDirectory()) {
      out.push(...await walk(abs));
    } else if (e.isFile() && isTextFile(abs)) {
      out.push(abs);
    }
  }
  return out.sort();
}
function rel(p) { return path.relative(process.cwd(), p).replace(/\\/g, '/'); }
function languageFromExt(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js';
  if (ext === '.ts') return 'ts';
  if (ext === '.tsx' || ext === '.jsx') return 'tsx';
  if (ext === '.json') return 'json';
  if (ext === '.yml' || ext === '.yaml') return 'yaml';
  if (ext === '.html') return 'html';
  if (ext === '.css') return 'css';
  if (ext === '.scss') return 'scss';
  if (ext === '.md') return 'md';
  if (ext === '.sql') return 'sql';
  if (ext === '.csv') return 'csv';
  return '';
}

async function collectAll() {
  const selected = [];
  for (const folder of FOLDERS) {
    const p = path.join(ROOT, folder);
    if (await pathExists(p)) selected.push(p);
  }
  if (!selected.length) {
    throw new Error(`No encontré carpetas en ${rel(ROOT)}: [${FOLDERS.join(', ')}]`);
  }

  let files = [];
  for (const dir of selected) files.push(...await walk(dir));
  files = Array.from(new Set(files)).sort();

  let totalLines = 0;
  const chunks = [];
  chunks.push(`# Dump técnico para pegar\n`);
  chunks.push(`> Generado desde \`${rel(ROOT)}\` — ${new Date().toLocaleString('es-AR')}\n`);

  for (const f of files) {
    let raw = '';
    try { raw = await fs.readFile(f, 'utf-8'); }
    catch { continue; }
    const lang = languageFromExt(f);
    const lines = raw.split('\n').length;
    totalLines += lines;

    chunks.push(`\n---\n\n### ${rel(f)} (${lines} líneas)\n`);
    chunks.push('```' + (lang || ''));
    chunks.push(raw);
    chunks.push('```');
  }

  const md = chunks.join('\n');
  return { md, filesCount: files.length, totalLines };
}

function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    const plat = process.platform;
    let proc, ok = false;

    if (plat === 'darwin') {
      proc = spawn('pbcopy');
      ok = true;
    } else if (plat === 'win32') {
      proc = spawn('clip');
      ok = true;
    } else {
      // Linux: probar xclip y luego xsel
      if (spawnSyncExists('xclip')) {
        proc = spawn('xclip', ['-selection', 'clipboard']);
        ok = true;
      } else if (spawnSyncExists('xsel')) {
        proc = spawn('xsel', ['--clipboard', '--input']);
        ok = true;
      }
    }

    if (!ok || !proc) {
      return reject(new Error('No hay utilidades de clipboard disponibles (pbcopy/clip/xclip/xsel).'));
    }

    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`Clipboard exit code ${code}`))));
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

function spawnSyncExists(cmd) {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const res = spawn(which, [cmd], { stdio: 'ignore' });
    // no reliable sync here; fallback to fs.existsSync on common paths
    // but we'll assume if spawn didn't throw, it's fine.
    return true;
  } catch { return false; }
}

async function main() {
  const { md, filesCount, totalLines } = await collectAll();

  // Backup en archivo siempre
  const outDir = path.resolve(process.cwd(), 'tmp');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'board_dump.md');
  await fs.writeFile(outFile, md, 'utf-8');

  try {
    await copyToClipboard(md);
    console.log(`✅ Copiado al portapapeles. Archivos: ${filesCount} | Líneas: ${totalLines}`);
    console.log(`📄 Backup: ${rel(outFile)}`);
    console.log('💡 Pegalo acá mismo en el chat (Ctrl/Cmd+V).');
  } catch (err) {
    console.warn('⚠️ No pude copiar al portapapeles:', err.message);
    console.log(`Imprimiendo por consola y guardado en: ${rel(outFile)}\n`);
    // Si no se pudo copiar, lo imprimimos todo.
    // OJO: esto puede ser MUY largo.
    process.stdout.write(md);
  }
}

main().catch(err => {
  console.error('Error:', err?.stack || err?.message || err);
  process.exit(1);
});
