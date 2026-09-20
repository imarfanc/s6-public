import { setupProfiles } from './profiles.js';
import { setupAiProfiles } from './ai-profiles.js';
import { icon } from './icons.js';
const running = new Set();
const entries = [
  { id: 'chrome', icon: 'simple-icons:googlechrome', name: 'Chrome Settings', app: 'Google Chrome', target: 'Warn Before Quitting → Disabled', description: 'Quit with ⌘Q without the hold-to-quit warning.', manual: 'Chrome menu → Warn Before Quitting (⌘Q): unchecked.' },
  { id: 'keyboard-maestro', icon: 'lucide:keyboard', name: 'Keyboard Maestro', target: 'Status Menu Icon → ⌘ Command', description: 'Use the Command symbol for the menu bar icon.', manual: 'Preferences → General → Status Menu Icon → Command. This is separate from Display Status Menu (for example, By Group).' },
];
const tablist = document.querySelector('[role=tablist]');
for (const entry of entries) {
  const tab = document.createElement('button');
  tab.role = 'tab';
  tab.id = `${entry.id}-tab`;
  tab.setAttribute('aria-controls', entry.id);
  tab.innerHTML = `${icon(entry.icon)}${entry.name}<span class="dot" id="${entry.id}-dot" aria-hidden="true"></span>`;
  tab.onclick = () => select(entry.id);
  tablist.append(tab);

  const article = document.createElement('article');
  article.id = entry.id;
  article.role = 'tabpanel';
  article.setAttribute('aria-labelledby', tab.id);
  article.innerHTML = `<div class="head"><h2>${entry.name}</h2><span class="badge" id="${entry.id}-badge">Not checked</span></div>
<div class="body"><p>${entry.description}</p><dl class="readout"><dt>Setting</dt><dd>${entry.target.split(' → ')[0]}</dd><dt>Target</dt><dd class="want">${entry.target.split(' → ')[1]}</dd><dt>Saved</dt><dd id="${entry.id}-current">—</dd></dl><p class="manual">By hand: ${entry.manual}</p></div>
<ol class="steps"><li><button data-action="quit">${icon('lucide:power')}Quit ${entry.app ?? entry.name}</button></li><li class="primary"><button class="primary" data-action="apply">${icon('lucide:wand-sparkles')}Run setup</button></li><li><button data-action="open">${icon('lucide:app-window')}Open ${entry.app ?? entry.name}</button></li></ol>
<div class="foot"><output id="${entry.id}-result" aria-live="polite"></output><button data-action="verify">${icon('lucide:circle-check')}Verify</button></div>`;
  document.querySelector('#settings').append(article);
  if (entry.id === 'chrome') setupSearch(article);
  for (const button of article.querySelectorAll('[data-action]')) button.onclick = () => run(entry, button.dataset.action);
}

function setupSearch(article) {
  const section = document.createElement('section');
  section.className = 'extra';
  section.innerHTML = `<div class="body"><h3>${icon('simple-icons:duckduckgo')}Default search engine</h3><p>Search from the address bar with DuckDuckGo.</p>
<dl class="readout"><dt>Setting</dt><dd>Search engine</dd><dt>Target</dt><dd class="want">DuckDuckGo</dd><dt>Saved</dt><dd id="search-current">—</dd></dl>
<p class="manual">Chrome protects this setting and resets it if a file is edited, so you pick it in Chrome: Open search settings → Change → DuckDuckGo → Set as Default. Single-profile controls use the last-used profile. All profiles runs sequentially, opens each profile’s search page for Luna, and stops on the first error or required user action.</p>
<div class="profile-actions"><button class="primary" data-search="open">${icon('lucide:settings')}Open search settings</button><button data-search="ai-apply">${icon('lucide:sparkles')}Set DuckDuckGo with Luna</button><button data-search="ai-all">${icon('lucide:sparkles')}Set all profiles with Luna</button><button data-search="verify-all">Verify all profiles</button><button data-search="verify">${icon('lucide:circle-check')}Verify</button></div>
<output id="search-result" aria-live="polite"></output></div>`;
  article.querySelector('.foot').after(section);
  for (const button of section.querySelectorAll('[data-search]')) button.onclick = () => runSearch(button.dataset.search);
}
async function runSearch(action) {
  const current = document.getElementById('search-current');
  const output = document.getElementById('search-result');
  const buttons = document.querySelectorAll('[data-search]');
  buttons.forEach(button => button.disabled = true);
  output.textContent = action.startsWith('ai-') ? 'Opening Luna in Terminal…' : action === 'open' ? 'Opening Chrome…' : 'Checking…';
  delete output.dataset.state;
  try {
    const response = await fetch(`/api/apps/app-settings1/chrome-search/${action}`, { method: action.startsWith('verify') ? 'GET' : 'POST', signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    if (action === 'open' || data.launched) { output.textContent = data.message; return; }
    if (data.profiles) {
      output.textContent = data.profiles.map(profile => `${profile.profile}: ${profile.current}${profile.matches ? ' ✓' : ''}`).join(' · ');
      output.dataset.state = data.matches ? 'ok' : 'bad';
      return;
    }
    current.textContent = data.current;
    current.dataset.state = output.dataset.state = data.matches ? 'ok' : 'bad';
    output.textContent = data.matches ? `DuckDuckGo is the default in ${data.profile}.` : `${data.current} is the default in ${data.profile}. Open search settings to change it.`;
  } catch (error) { output.textContent = error.message; output.dataset.state = 'bad'; }
  finally { buttons.forEach(button => button.disabled = false); }
}

const profilePanel = setupProfiles(select);
setupAiProfiles(select);
const tabs = [...entries, { id: 'chrome-profiles' }, { id: 'ai-profiles' }];
function select(id, focus = false) {
  if (!tabs.some(entry => entry.id === id)) id = tabs[0].id;
  for (const entry of tabs) {
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
  const index = tabs.findIndex(entry => document.getElementById(`${entry.id}-tab`) === document.activeElement);
  select(tabs[(index + step + tabs.length) % tabs.length].id, true);
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
    const response = await fetch(`/api/apps/app-settings1/${entry.id}/${action}`, {method: action.startsWith('verify') ? 'GET' : 'POST', signal: AbortSignal.timeout(20000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    if ('matches' in data) {
      badge.textContent = data.matches ? 'Matches target' : 'Needs attention';
      badge.dataset.match = dot.dataset.match = String(data.matches);
      const current = document.getElementById(`${entry.id}-current`);
      if (data.profiles) {
      output.textContent = data.profiles.map(profile => `${profile.profile}: ${profile.current}${profile.matches ? ' ✓' : ''}`).join(' · ');
      output.dataset.state = data.matches ? 'ok' : 'bad';
      return;
    }
    current.textContent = data.current;
      current.dataset.state = data.matches ? 'ok' : 'bad';
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
  try { await Promise.all([...entries.map(entry => run(entry, 'verify')), runSearch('verify'), profilePanel.verifyAll()]); }
  finally { event.target.disabled = false; }
};

// Initial inspection is read-only; setup runs only on a button click.
await Promise.all([...entries.map(entry => run(entry, 'verify')), runSearch('verify'), profilePanel.verifyAll()]);
