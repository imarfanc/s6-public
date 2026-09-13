const $ = (s) => document.querySelector(s);

// One entry per top-level YAML section. `command` returns a shell line, or null when the
// source is a link (Setapp, DMG) rather than something a terminal can install.
const KINDS = {
  formula: { section: 'formulae', label: 'Formulae', one: 'Formula', fallback: 'Command-line package', command: (i) => `brew install ${i.name}`, batch: (s) => `brew install ${s.map((i) => i.name).join(' ')}` },
  cask: { section: 'casks', label: 'Casks', one: 'Cask', fallback: 'Desktop app or font', command: (i) => `brew install --cask ${i.name}`, batch: (s) => `brew install --cask ${s.map((i) => i.name).join(' ')}` },
  dependency: { section: 'dependencies', label: 'Dependencies', one: 'Dependency', fallback: 'Supporting library', install: false },
  mas: { section: 'mas', label: 'App Store', one: 'App Store', fallback: 'Mac App Store app', command: (i) => i.appStoreId ? `mas install ${i.appStoreId}` : null, batch: (s) => { const ids = s.filter((i) => i.appStoreId).map((i) => i.appStoreId); return ids.length ? `mas install ${ids.join(' ')}` : null; } },
  setapp: { section: 'setapp', label: 'Setapp', one: 'Setapp', fallback: 'Setapp subscription app', link: 'Open in Setapp' },
  dmg: { section: 'dmgs', label: 'DMG', one: 'DMG', fallback: 'Direct download' },
  script: { section: 'scripts', label: 'Scripts', one: 'Vendor script', fallback: 'Install script', inventory: false, batch: (s) => s.map((i) => i.command).join('\n') },
};
const SECTIONS = Object.fromEntries(Object.entries(KINDS).filter(([, k]) => k.section).map(([key, k]) => [k.section, key]));

let items = [], view = location.hash === '#inventory' ? 'inventory' : 'install', category = 'all', selected = null;
const escape = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parse(text, expectedSection) {
  let section, item;
  const rows = [], metadata = {};
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const top = line.match(/^(\w+):(?: (.+))?$/);
    if (top) {
      if (top[2]) metadata[top[1]] = JSON.parse(top[2]);
      else { section = top[1]; item = null; }
      continue;
    }
    const start = line.match(/^  - name: (.+)$/);
    if (start && section === expectedSection) { item = { name: JSON.parse(start[1]), kind: SECTIONS[section] }; rows.push(item); continue; }
    const field = line.match(/^    (\w+): (.+)$/);
    if (field && item) { item[field[1] === 'id' ? 'appStoreId' : field[1]] = JSON.parse(field[2]); continue; }
    throw Error(`Invalid inventory line: ${line}`);
  }
  if (metadata.schema_version !== 1) throw Error('Unsupported inventory schema version');
  if (expectedSection && section !== expectedSection) throw Error(`Expected ${expectedSection} section`);
  return { metadata, rows };
}

async function readSource(file) {
  if (!/^[a-z]+\.yaml$/.test(file)) throw Error('Invalid inventory filename');
  const response = await fetch(`data/${file}`, { cache: 'no-store' });
  if (!response.ok) throw Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

function metadata(i) {
  return `<div class="package-meta">${[
    priorityLabel(i),
    i.version ? `Version ${escape(i.version)}` : '',
    i.updated ? `Updated ${escape(i.updated)}` : '',
    Number.isFinite(i.installs_365d) ? `${i.installs_365d.toLocaleString('en-US')} installs / 365 days` : '',
    i.group ? escape(i.group) : '',
  ].filter(Boolean).map((value) => `<span>${value}</span>`).join('')}</div>`;
}

const command = (i) => i.command || KINDS[i.kind].command?.(i) || null;
const inView = (i) => view === 'inventory' ? KINDS[i.kind].inventory !== false : KINDS[i.kind].install !== false;
const kindsInView = () => Object.keys(KINDS).filter((k) => items.some((i) => i.kind === k && inView(i)));
const groupOn = () => category === 'all' || category === 'cask';

const isFirstPick = (i) => Number.isInteger(i.priority) && i.priority > 0;
const isLastPick = (i) => Number.isInteger(i.priority) && i.priority < 0;
const priorityLabel = (i) => isFirstPick(i) ? `Priority ${i.priority}` : isLastPick(i) ? 'Priority last' : '';
const priorityRank = (i) => isFirstPick(i) ? [0, i.priority, i.id] : isLastPick(i) ? [2, -i.priority, i.id] : [1, 0, i.id];
const compareItems = (a, b) => {
  const [ra, pa, ida] = priorityRank(a), [rb, pb, idb] = priorityRank(b);
  return ra - rb || pa - pb || ida - idb;
};
function priorityGroups(rows) {
  return [
    ...[...new Set(rows.filter(isFirstPick).map((i) => i.priority))].sort((a, b) => a - b)
      .map((priority) => [`Priority ${priority}`, rows.filter((i) => i.priority === priority)]),
    ['No priority', rows.filter((i) => !isFirstPick(i) && !isLastPick(i))],
    ['Priority last', rows.filter(isLastPick)],
  ].filter(([, group]) => group.length);
}

function visible() {
  const q = $('#search').value.trim().toLowerCase();
  const group = groupOn() ? $('#group').value : 'all';
  return items.filter((i) => inView(i) && (category === 'all' || i.kind === category) &&
    (!$('#not-installed-only').checked || (installed && brewKind(i) && !installed[brewKind(i)].has(i.name.split('/').pop()))) &&
    (group === 'all' || (i.kind === 'cask' && (i.group || 'other') === group)) &&
    `${i.name} ${i.version || ''} ${i.description || ''} ${i.group || ''} ${i.url || ''} ${command(i) || ''}`.toLowerCase().includes(q)).sort(compareItems);
}

function link(i, text = 'Project') {
  return /^https?:\/\//.test(i.url || '') ? `<a href="${escape(i.url)}" target="_blank" rel="noreferrer" aria-label="${escape(text)}: ${escape(i.name)}">${escape(text)} ↗</a>` : '';
}

function downloadLink(i) {
  return /^https?:\/\//.test(i.download || '')
    ? `<a class="primary small" href="${escape(i.download)}" aria-label="Download ${escape(i.name)} DMG">Download DMG ↗</a>`
    : '';
}

function brewLink(i) {
  return /^https?:\/\//.test(i.brew_url || '')
    ? `<a href="${escape(i.brew_url)}" target="_blank" rel="noreferrer" aria-label="View ${escape(i.name)} on Homebrew Formulae">Brew ↗</a>`
    : '';
}

function icon(i) {
  const hasIcon = /^https?:\/\//.test(i.icon || '');
  const fit = i.icon_fit === 'cover' ? ' cover' : '';
  return `<span class="package-icon${hasIcon ? fit : ' missing'}" aria-hidden="true">${
    hasIcon ? `<img src="${escape(i.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''
  }<span class="icon-fallback">${i.kind === 'formula' || i.kind === 'script' ? '&gt;_' : '◇'}</span></span>`;
}

function preview(i, text = command(i)) {
  selected = i?.id ?? null;
  $('#panel-title').textContent = i ? i.name : 'Visible set';
  $('#command').value = text || '';
  $('#copy-command').disabled = !text;
  $('#status').textContent = text ? 'Ready to copy.' : '';
  document.querySelectorAll('.package-card').forEach((c) => c.toggleAttribute('aria-current', Number(c.dataset.id) === selected));
}

function clearPreview() {
  selected = null;
  $('#panel-title').textContent = 'Nothing selected';
  $('#command').value = '';
  $('#copy-command').disabled = true;
  $('#status').textContent = '';
}

async function copy(text, i) {
  preview(i, text);
  try { await navigator.clipboard.writeText(text); $('#status').textContent = 'Copied to clipboard.'; }
  catch { $('#command').focus(); $('#command').select(); $('#status').textContent = 'Clipboard unavailable. Copy the selected text manually.'; }
}

function batch(rows) {
  return Object.entries(KINDS).map(([k, def]) => {
    const set = rows.filter((i) => i.kind === k && command(i));
    const standard = set.filter((i) => !i.command), custom = set.filter((i) => i.command);
    return [standard.length && def.batch ? def.batch(standard) : standard.map(command).join('\n'), ...custom.map(command)].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

const INSTALLED_STORAGE_KEY = 'homebrew2.installed.v1';
let installed = null, installedCheckedAt = null;
function applyInstalled(data) {
  if (!data || !Array.isArray(data.casks) || !Array.isArray(data.formulae) ||
      ![...data.casks, ...data.formulae].every((name) => typeof name === 'string') ||
      typeof data.checkedAt !== 'string' || !Number.isFinite(Date.parse(data.checkedAt))) throw Error('Invalid Homebrew response.');
  installed = Object.fromEntries(['casks', 'formulae'].map((kind) => [kind, new Set(data[kind].map((name) => name.split('/').pop()))]));
  installedCheckedAt = data.checkedAt;
  $('#not-installed-only').disabled = false;
}
function installedSummary() {
  return `Last checked ${new Date(installedCheckedAt).toLocaleString()}: ${installed.casks.size} casks and ${installed.formulae.size} formulae installed on this server.`;
}
try {
  const saved = localStorage.getItem(INSTALLED_STORAGE_KEY);
  if (saved) {
    applyInstalled(JSON.parse(saved));
    $('#installed-status').textContent = `${installedSummary()} Saved results — recheck to refresh.`;
  }
} catch {
  $('#installed-status').textContent = 'Saved status unavailable. Check all installed to load current results.';
}
$('#not-installed-only').addEventListener('change', () => { clearPreview(); render(); });
const brewKind = (i) => i.kind === 'cask' ? 'casks' : ['formula', 'dependency'].includes(i.kind) ? 'formulae' : null;
function installedBadge(i) {
  const kind = brewKind(i);
  if (!kind) return '';
  if (!installed) return '<span class="install-state">Not checked</span>';
  const name = i.name.split('/').pop();
  return installed[kind].has(name)
    ? '<span class="install-state is-installed"><svg aria-hidden="true" width="16" height="16"><use href="#lucide--check"></use></svg>Installed</span>'
    : '<span class="install-state">Not installed</span>';
}

async function checkInstalled() {
  const button = $('#check-installed'), status = $('#installed-status');
  button.disabled = true;
  button.textContent = 'Checking…';
  status.textContent = 'Reading casks and formulae from Homebrew on this server…';
  try {
    const response = await fetch('/api/apps/homebrew2/installed', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Could not check Homebrew.');
    applyInstalled(data);
    status.textContent = installedSummary();
    try {
      localStorage.setItem(INSTALLED_STORAGE_KEY, JSON.stringify(data));
    } catch {
      status.textContent += ' Could not save in this browser; results are available for this session.';
    }
  } catch (error) {
    status.textContent = `${error.name === 'TimeoutError' ? 'The check timed out.' : error.message} ${installed ? `Showing previous results. ${installedSummary()}` : 'Status is unknown.'} Try again.`;
  } finally {
    button.disabled = false;
    button.textContent = 'Check all installed';
    render();
  }
}

// Inline the vendored Iconify sprite so checkmarks work without a CDN.
fetch('/shared/icons.svg').then((response) => {
  if (!response.ok) throw Error('Icon sprite unavailable');
  return response.text();
}).then((svg) => { $('#icon-sprite').innerHTML = svg; }).catch(console.error);
$('#check-installed').addEventListener('click', checkInstalled);

function card(i) {
  const def = KINDS[i.kind], cmd = command(i);
  const projectLabel = i.kind === 'setapp' ? 'Open in Setapp' : i.kind === 'mas' ? 'View in App Store' : 'Project';
  const actions = cmd
    ? `<button class="primary small" data-copy="${i.id}" aria-label="Copy ${escape(i.name)} command">Copy</button><button class="ghost small" data-preview="${i.id}" aria-label="Preview ${escape(i.name)} command">Preview</button>${brewLink(i)}${link(i, projectLabel)}`
    : `${i.kind === 'dmg' ? downloadLink(i) : ''}${link(i, i.kind === 'setapp' ? 'Open in Setapp' : 'Project')}` || '<span class="detail">No link yet</span>';
  return `<article class="package-card" data-id="${i.id}"${selected === i.id ? ' aria-current' : ''}>
    <div class="card-top"><span class="package-title">${icon(i)}<span class="package-name">${escape(i.name)}</span></span><span class="badge" data-kind="${i.kind}">${def.one}</span></div>
    <p class="detail">${escape(i.description || (i.version ? `v${i.version}` : def.fallback))}${i.group ? ` <span class="chip">${escape(i.group)}</span>` : ''}</p>
    ${metadata(i)}${installedBadge(i)}<div class="card-actions">${actions}</div></article>`;
}

function render() {
  const install = view === 'install';
  document.body.classList.toggle('install', install);
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#eyebrow').textContent = install ? '01 / INSTALL APPS' : '02 / THE COLLECTION';
  $('#title').textContent = install ? 'Your next setup starts here.' : 'A place for every package.';
  $('#intro').textContent = install ? 'Find a tool. Copy the command. Take it to your terminal.' : 'The tools, desktop apps, and dependencies in your saved inventory.';
  $('#command-panel').hidden = !install;

  const kinds = kindsInView();
  if (!kinds.includes(category)) category = 'all';
  const count = (k) => items.filter((i) => i.kind === k && inView(i)).length;
  $('#stats').innerHTML = [['Total', kinds.reduce((n, k) => n + count(k), 0)], ...kinds.map((k) => [KINDS[k].label, count(k)])]
    .map(([label, n]) => `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join('');
  $('#categories').innerHTML = ['all', ...kinds].map((k) => `<button data-category="${k}" aria-pressed="${category === k}">${k === 'all' ? 'All' : KINDS[k].label}</button>`).join('');
  $('#group').disabled = !groupOn();

  const rows = visible();
  $('#count').textContent = `${rows.length} ${install ? 'shown' : 'packages'}`;
  if (!rows.length) {
    $('#results').innerHTML = '<div class="empty"><h2>No matching packages</h2><p>Try another search or reset your filters.</p><button class="ghost" id="reset">Reset filters</button></div>';
    return;
  }
  if (!install) {
    $('#results').innerHTML = `<div class="table-wrap"><table><thead><tr><th scope="col">PACKAGE</th><th scope="col">SAVED VERSION</th><th scope="col">TYPE</th><th scope="col">DETAILS</th></tr></thead><tbody>${
      priorityGroups(rows).map(([label, group]) => `<tr class="priority-heading"><th colspan="4" scope="rowgroup">${label} <span class="group-count">${group.length}</span></th></tr>` + group.map((i) => `<tr><td><span class="package-title">${icon(i)}<span>${escape(i.name)}</span></span>${installedBadge(i)}</td><td>${escape(i.version || '—')}</td><td><span class="badge" data-kind="${i.kind}">${KINDS[i.kind].one}</span></td><td class="detail">${escape(i.description || KINDS[i.kind].fallback)}${metadata(i)} ${brewLink(i)} ${link(i, KINDS[i.kind].link)} </td></tr>`).join('')).join('')
    }</tbody></table></div>`;
  } else {
    const copyable = rows.filter(command).length;
    $('#results').innerHTML = `<div class="copy-set"><h2>${category === 'all' ? 'Installable collection' : KINDS[category].label}</h2><button class="ghost" id="copy-visible"${copyable ? '' : ' disabled'}>Copy ${copyable} as one batch</button></div>${priorityGroups(rows).map(([label, group]) => `<section class="priority-group"><h3>${label} <span class="group-count">${group.length}</span></h3><div class="cards">${group.map(card).join('')}</div></section>`).join('')}`;
  }
}

function resetFilters() { $('#not-installed-only').checked = false; $('#search').value = ''; $('#group').value = 'all'; category = 'all'; render(); }

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.view; }));
window.addEventListener('hashchange', () => { view = location.hash === '#inventory' ? 'inventory' : 'install'; category = 'all'; render(); });
$('#categories').addEventListener('click', (e) => { const b = e.target.closest('[data-category]'); if (b) { category = b.dataset.category; clearPreview(); render(); } });
$('#search').addEventListener('input', render);
$('#group').addEventListener('change', render);
$('#results').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'reset') resetFilters();
  else if (b.id === 'copy-visible') copy(batch(visible()), null);
  else if (b.dataset.copy !== undefined) copy(command(items[Number(b.dataset.copy)]), items[Number(b.dataset.copy)]);
  else if (b.dataset.preview !== undefined) preview(items[Number(b.dataset.preview)]);
});
$('#copy-command').addEventListener('click', () => copy($('#command').value, items[selected]));
document.addEventListener('error', (event) => {
  if (event.target.matches?.('.package-icon img')) event.target.closest('.package-icon').classList.add('missing');
}, true);
document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select');
  if (e.key === '/' && !typing) { e.preventDefault(); $('#search').focus(); }
  else if (e.key === 'Escape' && e.target.id === 'search' && $('#search').value) { $('#search').value = ''; render(); }
});

async function load() {
  try {
    const { metadata: manifest } = parse(await readSource('inventory.yaml'));
    const sections = Object.keys(SECTIONS);
    const sources = await Promise.all(sections.map(async (section) => {
      if (typeof manifest[section] !== 'string') throw Error(`Missing ${section} source`);
      return parse(await readSource(manifest[section]), section).rows;
    }));
    items = sources.flat().map((item, id) => ({ ...item, id }));
    const date = manifest.captured_on;
    $('#sources').innerHTML = '<summary>Download source YAML</summary>' + [['Manifest', 'inventory.yaml'], ...sections.map((section) => [KINDS[SECTIONS[section]].label, manifest[section]])].map(([label, file]) => `<a href="data/${escape(file)}" download>${escape(label)} ↗</a>`).join('');
    if (date) {
      const d = new Date(`${date}T12:00:00`);
      $('#snapshot-date').textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      $('#snapshot').textContent = `SNAPSHOT / ${date.replaceAll('-', '.')}`;
    }
    const groups = [...new Set(items.filter((i) => i.kind === 'cask').map((i) => i.group || 'other'))].sort();
    $('#group').innerHTML = '<option value="all">All groups</option>' + groups.map((g) => `<option value="${escape(g)}">${escape(g)}</option>`).join('');
    render();
  } catch (error) {
    $('#count').textContent = 'Unavailable';
    $('#results').innerHTML = '<div class="empty"><h2>Inventory could not be loaded</h2><p>Check that the inventory manifest and its source files use schema version 1 and are available, then reload this page.</p><button class="ghost" id="retry">Try again</button></div>';
    $('#retry').onclick = load;
    console.error(error);
  }
}
load();
