import { compareEntries, groupKey, readRecent, markOpened } from './organize.js';
import { fileType, standaloneURL, preview as renderPreview } from './preview.js';
const $ = selector => document.querySelector(selector);
const api = '/api/apps/pages-lite/files';
let entries = [], generation = 0;
async function get(url, signal) {
  const response = await fetch(url, { cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load files.');
  return data;
}
const readerURL = name => `reader.html?file=${encodeURIComponent(name)}`;
try {
  const group = localStorage.getItem('pages-grid.group');
  $('#group').value = ['folder', 'none', 'type', 'initial', 'recent'].includes(group) ? group : group === 'false' ? 'none' : 'folder';
  const sort = localStorage.getItem('pages-grid.sort');
  if (['name', 'name-desc', 'recent', 'type', 'folder'].includes(sort)) $('#sort').value = sort;
  $('#open-mode').value = localStorage.getItem('pages-grid.open') === 'dialog' ? 'dialog' : 'standalone';
} catch {}
function savePreferences() {
  try {
    localStorage.setItem('pages-grid.group', $('#group').value);
    localStorage.setItem('pages-grid.sort', $('#sort').value);
    localStorage.setItem('pages-grid.open', $('#open-mode').value);
  } catch {}
}
function arrange() {
  const grid = $('#grid'); grid.replaceChildren();
  const mode = $('#group').value, recent = readRecent();
  grid.classList.toggle('grouped', mode !== 'none');
  const groups = new Map();
  for (const entry of [...entries].sort(compareEntries($('#sort').value, recent))) {
    const folder = groupKey(entry.name, mode, recent);
    entry.card.querySelector('.filename').textContent = mode === 'folder' ? entry.name.split('/').pop() : entry.name;
    if (mode === 'none') { grid.append(entry.card); continue; }
    if (!groups.has(folder)) {
      const section = document.createElement('section'); section.className = 'folder-group';
      const heading = document.createElement('h2');
      const title = document.createElement('span'); title.textContent = folder || 'Main folder';
      const count = document.createElement('span'); count.className = 'count';
      heading.append(title, count);
      const cards = document.createElement('div'); cards.className = 'folder-grid';
      section.append(heading, cards); grid.append(section); groups.set(folder, cards);
    }
    groups.get(folder).append(entry.card);
  }
  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Earlier', 'Never opened'];
  for (const [key, cards] of [...groups].sort(([a], [b]) => mode === 'recent' ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b, undefined, { numeric: true }))) grid.append(cards.parentElement);
  filter();
}
function show(entry) {
  markOpened(entry.name);
  arrange();
  if ($('#open-mode').value === 'standalone') { window.open(standaloneURL(entry.name), '_blank', 'noopener'); return; }
  $('#standalone').href = standaloneURL(entry.name);
  $('#reader-title').textContent = entry.name;
  $('#full-preview').src = readerURL(entry.name);
  $('#reader').showModal();
}
function filter() {
  const query = $('#search').value.trim().toLowerCase();
  let visible = 0;
  for (const entry of entries) {
    entry.card.hidden = !entry.name.toLowerCase().includes(query);
    if (!entry.card.hidden) visible++;
  }
  document.querySelectorAll('.folder-group').forEach(group => {
    const shown = Array.from(group.querySelectorAll('.card')).filter(card => !card.hidden).length;
    group.hidden = !shown;
    group.querySelector('.count').textContent = `${shown} ${shown === 1 ? 'file' : 'files'}`;
  });
  $('#status').textContent = entries.length ? (visible ? `${visible} ${visible === 1 ? 'file' : 'files'}` : 'No matching files.') : 'No files yet. Add an HTML, Markdown, TOML, or JSON file, then refresh.';
}
function card(name) {
  const element = document.createElement('article'); element.className = 'card';
  const preview = document.createElement('div'); preview.className = 'thumbnail';
  const loading = document.createElement('p'); loading.className = 'card-error'; loading.textContent = 'Loading preview…'; preview.append(loading);
  const button = document.createElement('button'); button.type = 'button'; button.disabled = true; button.setAttribute('aria-label', `Open ${name}`);
  const label = document.createElement('span'); label.className = 'filename'; label.textContent = name;
  const kind = document.createElement('span'); kind.className = 'kind'; kind.textContent = fileType(name).toUpperCase(); kind.dataset.kind = fileType(name);
  button.append(label, kind); element.append(preview, button);
  const entry = { name, card: element, preview, button, document: '' };
  button.onclick = () => show(entry);
  return entry;
}
let controller;
async function refresh() {
  const current = ++generation;
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal;
  $('#refresh').disabled = true; $('#status').textContent = 'Loading files…';
  entries = []; $('#grid').replaceChildren();
  try {
    const { files } = await get(api, signal);
    if (current !== generation) return;
    entries = files.map(card); arrange();
    // Bound concurrent reads so a large folder does not flood the server.
    const pending = [...entries];
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length && !signal.aborted) {
        const entry = pending.shift();
        try {
          const { content } = await get(`${api}?file=${encodeURIComponent(entry.name)}`, signal);
          if (current !== generation) return;
          entry.document = renderPreview(entry.name, content);
          const frame = document.createElement('iframe'); frame.title = `Preview of ${entry.name}`;
          frame.setAttribute('sandbox', ''); frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
          frame.srcdoc = entry.document; entry.preview.replaceChildren(frame); entry.button.disabled = false;
        } catch (error) {
          if (signal.aborted) return;
          entry.preview.firstElementChild.textContent = `${error.message} Use Refresh to retry.`;
        }
      }
    }));
  } catch (error) {
    if (!signal.aborted) $('#status').textContent = `${error.message} Use Refresh to retry.`;
  } finally {
    if (current === generation) $('#refresh').disabled = false;
  }
}
$('#search').addEventListener('input', filter);
$('#refresh').addEventListener('click', refresh);
$('#close').addEventListener('click', () => $('#reader').close());
$('#reader').addEventListener('close', () => $('#full-preview').src = 'about:blank');
for (const id of ['#group', '#sort']) $(id).addEventListener('change', () => { savePreferences(); arrange(); });
window.addEventListener('storage', () => arrange());
window.addEventListener('focus', () => arrange());
$('#open-mode').addEventListener('change', savePreferences);
await refresh();
