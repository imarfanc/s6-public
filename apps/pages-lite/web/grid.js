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
const folderOf = name => name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
const baseName = name => name.split('/').pop();
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const typeNames = { html: 'HTML pages', md: 'Markdown notes', toml: 'TOML files', json: 'JSON files' };
const openMode = () => document.querySelector('input[name=open-mode]:checked').value;

try {
  const group = localStorage.getItem('pages-grid.group');
  $('#group').value = ['folder', 'none', 'type', 'initial', 'recent'].includes(group) ? group : group === 'false' ? 'none' : 'folder';
  const sort = localStorage.getItem('pages-grid.sort');
  if (['name', 'name-desc', 'recent', 'type', 'folder'].includes(sort)) $('#sort').value = sort;
  if (localStorage.getItem('pages-grid.open') === 'dialog') document.querySelector('input[name=open-mode][value=dialog]').checked = true;
} catch {}
function savePreferences() {
  try {
    localStorage.setItem('pages-grid.group', $('#group').value);
    localStorage.setItem('pages-grid.sort', $('#sort').value);
    localStorage.setItem('pages-grid.open', openMode());
  } catch {}
}

// The scope lives in the hash (#folder/shopping, #type/md, #recent) so it survives reloads and can be bookmarked.
function readScope() {
  let hash = '';
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch {}
  const [kind, ...rest] = hash.split('/');
  if (kind === 'recent') return { kind, value: '' };
  if (kind === 'folder' || kind === 'type') return { kind, value: rest.join('/') };
  return { kind: 'all', value: '' };
}
const scopeHash = ({ kind, value }) => kind === 'all' ? '' : kind === 'recent' ? '#recent' : `#${kind}/${value.split('/').map(encodeURIComponent).join('/')}`;
function inScope(name, scope, recent) {
  if (scope.kind === 'recent') return Boolean(recent[name]);
  if (scope.kind === 'type') return fileType(name) === scope.value;
  if (scope.kind === 'folder') return scope.value === '' ? !name.includes('/') : name.startsWith(`${scope.value}/`);
  return true;
}
const sameScope = (a, b) => a.kind === b.kind && a.value === b.value;

const icons = {
  all: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  type: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};
function scopeButton(scope, label, count, depth = 0, parent = '') {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'scope'; button.dataset.scope = scopeHash(scope) || '#';
  button.style.setProperty('--depth', depth);
  button.innerHTML = `<svg class="icon" viewBox="0 0 24 24">${icons[scope.kind]}</svg>`;
  const name = document.createElement('span'); name.className = 'scope-name';
  if (parent) { const prefix = document.createElement('span'); prefix.className = 'scope-parent'; prefix.textContent = `${parent}/`; name.append(prefix); }
  name.append(label);
  const tally = document.createElement('span'); tally.className = 'scope-count'; tally.textContent = count;
  button.append(name, tally);
  button.onclick = () => setScope(scope);
  const item = document.createElement('li'); item.append(button);
  return item;
}
function navSection(label, items) {
  const section = document.createElement('div'); section.className = 'nav-section';
  const heading = document.createElement('p'); heading.className = 'nav-label'; heading.textContent = label;
  const list = document.createElement('ul'); list.append(...items);
  section.append(heading, list);
  return section;
}
function renderScopes() {
  const names = entries.map(entry => entry.name), recent = readRecent();
  const count = test => names.filter(test).length;
  const folders = new Set();
  for (const name of names) {
    const parts = folderOf(name).split('/').filter(Boolean);
    parts.forEach((_, index) => folders.add(parts.slice(0, index + 1).join('/')));
  }
  const folderItems = [...folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).map(path => {
    const parts = path.split('/');
    return scopeButton({ kind: 'folder', value: path }, parts.at(-1), count(name => name.startsWith(`${path}/`)), parts.length - 1, parts.slice(0, -1).join('/'));
  });
  const topLevel = count(name => !name.includes('/'));
  if (topLevel && folders.size) folderItems.unshift(scopeButton({ kind: 'folder', value: '' }, 'Main folder', topLevel));
  const types = [...new Set(names.map(fileType))].sort((a, b) => Object.keys(typeNames).indexOf(a) - Object.keys(typeNames).indexOf(b));
  const sections = [navSection('Library', [
    scopeButton({ kind: 'all', value: '' }, 'All files', names.length),
    scopeButton({ kind: 'recent', value: '' }, 'Recently opened', count(name => recent[name])),
  ])];
  if (folderItems.length) sections.push(navSection('Folders', folderItems));
  if (types.length > 1) sections.push(navSection('Types', types.map(type => scopeButton({ kind: 'type', value: type }, typeNames[type] || type.toUpperCase(), count(name => fileType(name) === type)))));
  $('#scopes').replaceChildren(...sections);
  markScope();
}
function markScope() {
  const current = scopeHash(readScope()) || '#';
  for (const button of document.querySelectorAll('.scope')) button.setAttribute('aria-current', String(button.dataset.scope === current));
  // Keep the active scope visible inside the rail (or chip row) without scrolling the page.
  const active = document.querySelector('.scope[aria-current=true]'), rail = $('#scopes');
  if (active) {
    const a = active.getBoundingClientRect(), r = rail.getBoundingClientRect();
    if (a.left < r.left || a.right > r.right) rail.scrollLeft += a.left - r.left - 16;
    if (a.top < r.top || a.bottom > r.bottom) rail.scrollTop += a.top - r.top - 40;
  }
  const scope = readScope();
  $('#crumb').textContent = { all: 'Library', recent: 'Library', folder: 'Folder', type: 'File type' }[scope.kind];
  $('#scope-title').textContent = scope.kind === 'all' ? 'All files' : scope.kind === 'recent' ? 'Recently opened'
    : scope.kind === 'type' ? typeNames[scope.value] || scope.value.toUpperCase() : scope.value || 'Main folder';
}
function setScope(scope) {
  if (!sameScope(scope, readScope())) history.pushState(null, '', scopeHash(scope) || location.pathname + location.search);
  markScope(); arrange();
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function openedLabel(time) {
  if (!time) return '';
  const start = date => new Date(date).setHours(0, 0, 0, 0);
  const days = Math.round((start(Date.now()) - start(time)) / 864e5);
  return `Opened ${days < 1 ? 'today' : days < 30 ? relative.format(-days, 'day') : new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
// Moving a card reloads its preview iframe, so only rebuild the grid when order or grouping changed.
let layout = '';
function arrange() {
  const grid = $('#grid'), mode = $('#group').value, recent = readRecent();
  const sorted = [...entries].sort(compareEntries($('#sort').value, recent));
  for (const entry of sorted) {
    const meta = [mode === 'folder' ? '' : folderOf(entry.name), openedLabel(recent[entry.name])].filter(Boolean);
    entry.meta.replaceChildren(...meta.map(text => Object.assign(document.createElement('span'), { textContent: text })));
  }
  const next = `${mode}\n${sorted.map(entry => `${groupKey(entry.name, mode, recent)}\0${entry.name}`).join('\n')}`;
  if (next === layout && grid.childElementCount) return filter();
  layout = next; grid.replaceChildren();
  grid.classList.toggle('grouped', mode !== 'none');
  const groups = new Map();
  for (const entry of sorted) {
    const folder = groupKey(entry.name, mode, recent);
    if (mode === 'none') { grid.append(entry.card); continue; }
    if (!groups.has(folder)) {
      const section = document.createElement('section'); section.className = 'folder-group';
      const heading = document.createElement('h3');
      const title = document.createElement('span'); title.textContent = folder || 'Main folder';
      const count = document.createElement('span'); count.className = 'count';
      heading.append(title, count);
      const cards = document.createElement('div'); cards.className = 'folder-grid';
      section.append(heading, cards); grid.append(section); groups.set(folder, cards);
    }
    groups.get(folder).append(entry.card);
  }
  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Earlier', 'Never opened'];
  for (const [, cards] of [...groups].sort(([a], [b]) => mode === 'recent' ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b, undefined, { numeric: true }))) grid.append(cards.parentElement);
  filter();
}
function show(entry) {
  markOpened(entry.name);
  renderScopes(); arrange();
  if (openMode() === 'standalone') { window.open(standaloneURL(entry.name), '_blank', 'noopener'); return; }
  $('#standalone').href = standaloneURL(entry.name);
  $('#reader-title').textContent = baseName(entry.name);
  $('#reader-path').textContent = folderOf(entry.name);
  $('#reader-kind').textContent = fileType(entry.name); $('#reader-kind').dataset.kind = fileType(entry.name);
  $('#full-preview').src = readerURL(entry.name);
  $('#reader').showModal();
}
function filter() {
  const query = $('#search').value.trim().toLowerCase(), scope = readScope(), recent = readRecent();
  let visible = 0, scoped = 0;
  for (const entry of entries) {
    const inside = inScope(entry.name, scope, recent);
    entry.card.hidden = !inside || !entry.name.toLowerCase().includes(query);
    if (inside) scoped++;
    if (!entry.card.hidden) visible++;
  }
  let groupsShown = 0;
  document.querySelectorAll('.folder-group').forEach(group => {
    const shown = Array.from(group.querySelectorAll('.card')).filter(card => !card.hidden).length;
    group.hidden = !shown;
    if (shown) groupsShown++;
    group.querySelector('.count').textContent = plural(shown, 'file');
  });
  // A lone group heading only repeats the page title.
  $('#grid').classList.toggle('single', groupsShown === 1);
  const where = $('#scope-title').textContent;
  $('#status').textContent = !entries.length ? '' : query ? `${visible} of ${plural(scoped, 'file')} match “${$('#search').value.trim()}”` : plural(visible, 'file');
  $('#status').hidden = !visible;
  $('#empty').hidden = Boolean(visible);
  $('#clear').hidden = !entries.length;
  $('#empty-message').textContent = !entries.length
    ? 'No files yet. Add an HTML, Markdown, TOML, or JSON file to apps/pages-lite/data/, then Refresh.'
    : query ? `Nothing in ${where} matches “${$('#search').value.trim()}”.`
    : scope.kind === 'recent' ? 'Nothing opened yet. Files you open in this browser appear here.' : `No files in ${where}.`;
}
function card(name) {
  const element = document.createElement('article'); element.className = 'card'; element.dataset.kind = fileType(name);
  const preview = document.createElement('div'); preview.className = 'thumbnail';
  const loading = document.createElement('p'); loading.className = 'card-note'; loading.textContent = 'Loading preview…'; preview.append(loading);
  const button = document.createElement('button'); button.type = 'button'; button.disabled = true; button.setAttribute('aria-label', `Open ${name}`);
  const label = document.createElement('span'); label.className = 'filename'; label.textContent = baseName(name); label.title = name;
  const kind = document.createElement('span'); kind.className = 'kind'; kind.textContent = fileType(name); kind.dataset.kind = fileType(name);
  const meta = document.createElement('span'); meta.className = 'meta';
  button.append(label, kind, meta); element.append(preview, button);
  const entry = { name, card: element, preview, button, meta, document: '' };
  button.onclick = () => show(entry);
  return entry;
}
let controller;
async function refresh() {
  const current = ++generation;
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal;
  $('#refresh').disabled = true; $('#status').hidden = false; $('#status').textContent = 'Loading files…'; $('#empty').hidden = true;
  entries = []; layout = ''; $('#grid').replaceChildren();
  try {
    const { files } = await get(api, signal);
    if (current !== generation) return;
    entries = files.map(card); renderScopes(); arrange();
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
          frame.setAttribute('sandbox', ''); frame.setAttribute('scrolling', 'no'); frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
          frame.onload = () => entry.preview.querySelector('.card-note')?.remove();
          frame.srcdoc = entry.document; entry.preview.append(frame); entry.button.disabled = false;
        } catch (error) {
          if (signal.aborted) return;
          const note = entry.preview.querySelector('.card-note');
          note.classList.add('error'); note.textContent = `${error.message} Use Refresh to retry.`;
        }
      }
    }));
  } catch (error) {
    if (!signal.aborted) { $('#status').hidden = false; $('#status').textContent = `${error.message} Use Refresh to retry.`; }
  } finally {
    if (current === generation) $('#refresh').disabled = false;
  }
}
$('#search').addEventListener('input', filter);
$('#refresh').addEventListener('click', refresh);
$('#clear').addEventListener('click', () => { $('#search').value = ''; setScope({ kind: 'all', value: '' }); $('#search').focus(); });
$('#close').addEventListener('click', () => $('#reader').close());
$('#reader').addEventListener('close', () => $('#full-preview').src = 'about:blank');
for (const id of ['#group', '#sort']) $(id).addEventListener('change', () => { savePreferences(); arrange(); });
for (const radio of document.querySelectorAll('input[name=open-mode]')) radio.addEventListener('change', savePreferences);
window.addEventListener('popstate', () => { renderScopes(); arrange(); });
window.addEventListener('storage', () => { renderScopes(); arrange(); });
window.addEventListener('focus', () => { renderScopes(); arrange(); });
// "/" jumps to search from anywhere outside a text field.
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || $('#reader').open) return;
  if (event.target.closest('input, select, textarea, [contenteditable]')) return;
  event.preventDefault(); $('#search').focus(); $('#search').select();
});
await refresh();
