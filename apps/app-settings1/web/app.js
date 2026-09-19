const running = new Set();
const entries = [
  { id: 'chrome', name: 'Google Chrome', target: 'Warn Before Quitting → Disabled', description: 'Quit with ⌘Q without the hold-to-quit warning.', manual: 'Chrome menu → Warn Before Quitting (⌘Q): unchecked.' },
  { id: 'keyboard-maestro', name: 'Keyboard Maestro', target: 'Status Menu Icon → ⌘ Command', description: 'Use the Command symbol for the menu bar icon.', manual: 'Preferences → General → Status Menu Icon → Command. This is separate from Display Status Menu (for example, By Group).' },
];
const tablist = document.querySelector('[role=tablist]');
for (const entry of entries) {
  const tab = document.createElement('button');
  tab.role = 'tab';
  tab.id = `${entry.id}-tab`;
  tab.setAttribute('aria-controls', entry.id);
  tab.innerHTML = `<span class="dot" id="${entry.id}-dot" aria-hidden="true"></span>${entry.name}`;
  tab.onclick = () => select(entry.id);
  tablist.append(tab);

  const article = document.createElement('article');
  article.id = entry.id;
  article.role = 'tabpanel';
  article.setAttribute('aria-labelledby', tab.id);
  article.innerHTML = `<div class="head"><h2>${entry.name}</h2><span class="badge" id="${entry.id}-badge">Not checked</span></div>
<div class="body"><p>${entry.description}</p><dl class="readout"><dt>Setting</dt><dd>${entry.target.split(' → ')[0]}</dd><dt>Target</dt><dd class="want">${entry.target.split(' → ')[1]}</dd><dt>Saved</dt><dd id="${entry.id}-current">—</dd></dl><p class="manual">By hand: ${entry.manual}</p></div>
<ol class="steps"><li><button data-action="quit">Quit ${entry.name}</button></li><li class="primary"><button class="primary" data-action="apply">Run setup</button></li><li><button data-action="open">Open ${entry.name}</button></li></ol>
<div class="foot"><output id="${entry.id}-result" aria-live="polite"></output><button data-action="verify">Verify</button></div>`;
  document.querySelector('#settings').append(article);
  for (const button of article.querySelectorAll('[data-action]')) button.onclick = () => run(entry, button.dataset.action);
}

function select(id, focus = false) {
  if (!entries.some(entry => entry.id === id)) id = entries[0].id;
  for (const entry of entries) {
    const on = entry.id === id;
    const tab = document.getElementById(`${entry.id}-tab`);
    tab.setAttribute('aria-selected', on);
    tab.tabIndex = on ? 0 : -1;
    document.getElementById(entry.id).hidden = !on;
    if (on && focus) tab.focus();
  }
  history.replaceState(null, '', `#${id}`);
}
tablist.onkeydown = (event) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const index = entries.findIndex(entry => document.getElementById(`${entry.id}-tab`) === document.activeElement);
  select(entries[(index + step + entries.length) % entries.length].id, true);
};
select(location.hash.slice(1));

const labels = { verify: 'Checking…', apply: 'Running…', quit: 'Quitting…', open: 'Opening…' };
async function run(entry, action) {
  if (running.has(entry.id)) return;
  running.add(entry.id);
  const buttons = document.getElementById(entry.id).querySelectorAll('button[data-action]');
  const badge = document.getElementById(`${entry.id}-badge`);
  const dot = document.getElementById(`${entry.id}-dot`);
  const result = document.getElementById(`${entry.id}-result`);
  const previous = badge.textContent;
  buttons.forEach(button => button.disabled = true);
  badge.textContent = labels[action];
  result.textContent = '';
  try {
    const response = await fetch(`/api/apps/app-settings1/${entry.id}/${action}`, {method: action === 'verify' ? 'GET' : 'POST', signal: AbortSignal.timeout(20000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    if ('matches' in data) {
      badge.textContent = data.matches ? 'Matches target' : 'Needs attention';
      badge.dataset.match = dot.dataset.match = String(data.matches);
      document.getElementById(`${entry.id}-current`).textContent = data.current;
      result.textContent = `${data.note}${data.backup ? ` Backup: ${data.backup}` : ''}`;
    } else {
      badge.textContent = previous;
      result.textContent = data.message;
    }
  } catch(error) {
    badge.textContent = { apply: 'Setup not completed', verify: 'Could not verify' }[action] ?? previous;
    if (action === 'apply' || action === 'verify') { delete badge.dataset.match; delete dot.dataset.match; }
    result.textContent = error.message;
  } finally { running.delete(entry.id); buttons.forEach(button => button.disabled = false); }
}
document.querySelector('#verify-all').onclick = async (event) => {
  event.target.disabled = true;
  try { await Promise.all(entries.map(entry => run(entry, 'verify'))); }
  finally { event.target.disabled = false; }
};

// Initial inspection is read-only; setup runs only on a button click.
await Promise.all(entries.map(entry => run(entry, 'verify')));
