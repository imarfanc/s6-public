import { icon } from './icons.js';

export function setupProfiles(select) {
  const tab = document.createElement('button');
  tab.id = 'chrome-profiles-tab';
  tab.role = 'tab';
  tab.setAttribute('aria-controls', 'chrome-profiles');
  tab.innerHTML = `${icon('lucide:users-round')}Chrome Profiles`;
  tab.onclick = () => select('chrome-profiles');
  document.querySelector('[role=tablist]').append(tab);
  const panel = document.createElement('article');
  panel.id = 'chrome-profiles';
  panel.role = 'tabpanel';
  panel.setAttribute('aria-labelledby', tab.id);
  panel.innerHTML = `<div class="head"><h2>Chrome Profiles</h2><span class="badge">Local profiles</span></div>
    <div class="body"><p>Create separate spaces for your bookmarks, extensions and browsing. Start with these two names, or edit them before creating.</p><p class="manual">Create &amp; open launches Chrome with the profile. Google sign-in is optional. Existing profiles with the same name are reused.</p><p class="manual">Prefer to watch AI do it, or sign in to Google? Use the Chrome Profiles AI tab.</p><div id="profile-plans"></div></div>
    <div class="foot"><output id="profiles-result" aria-live="polite"></output><button id="profiles-verify-all">${icon('lucide:refresh-cw')}Verify profiles</button></div>
    <div class="body"><h3>Profiles on this Mac</h3><ul id="profiles-installed"></ul><p class="manual">Standard Google Chrome only. Verification checks Chrome’s saved profile list and Preferences file. Custom user-data directories are not included.</p></div>`;
  document.querySelector('#settings').append(panel);
  let names = ['Personal', 'Work'];
  try {
    const saved = JSON.parse(localStorage.getItem('app-settings1.profile-names'));
    if (Array.isArray(saved) && saved.length === 2 && saved.every(name => typeof name === 'string')) names = saved;
  } catch { /* Storage is optional. */ }
  const rows = names.map((name, index) => {
    const row = document.createElement('div');
    row.className = 'profile-plan';
    row.innerHTML = `<label for="profile-name-${index}">Profile ${index + 1}</label><input id="profile-name-${index}" maxlength="60" required autocomplete="off"><div class="profile-actions"><button class="primary" id="profile-create-${index}">${icon('lucide:circle-plus')}Create &amp; open</button><button id="profile-verify-${index}">${icon('lucide:circle-check')}Verify</button></div><output id="profile-result-${index}" aria-live="polite">Not checked.</output>`;
    row.querySelector('input').value = name;
    document.querySelector('#profile-plans').append(row);
    const input = row.querySelector('input');
    input.oninput = () => {
      row.querySelector('output').textContent = 'Name changed. Verify or create this profile.';
      names[index] = input.value;
      try { localStorage.setItem('app-settings1.profile-names', JSON.stringify(names)); } catch { /* optional */ }
    };
    let busy = false;
    async function run(action) {
      if (busy) return;
      if (!input.reportValidity()) return;
      busy = true;
      row.querySelectorAll('input,button').forEach(control => control.disabled = true);
      const output = row.querySelector('output');
      output.textContent = action === 'create' ? 'Creating and opening in Chrome…' : 'Verifying…';
      delete output.dataset.state;
      try {
        const name = input.value.trim();
        const data = await request(action, name);
        output.textContent = `${data.verified ? 'Verified' : data.exists ? 'Pending verification' : action === 'create' ? 'Waiting for Chrome' : 'Not found'}: ${name}. ${data.message || (data.verified ? `Saved in ${data.directory}.` : 'Create the profile, or finish setup in Chrome and verify again.')}`;
        output.dataset.state = data.verified ? 'ok' : data.exists || action === 'create' ? 'pending' : 'bad';
        if (action === 'create') await refresh();
      } catch (error) { output.textContent = error.message; output.dataset.state = 'bad'; }
      finally { busy = false; row.querySelectorAll('input,button').forEach(control => control.disabled = false); }
    }
    row.querySelector(`#profile-create-${index}`).onclick = () => run('create');
    row.querySelector(`#profile-verify-${index}`).onclick = () => run('verify');
    return { run };
  });
  async function request(action, name) {
    const response = await fetch(`/api/apps/app-settings1/chrome-profiles/${action}${action === 'verify' ? `?name=${encodeURIComponent(name)}` : ''}`, {
      method: action === 'create' ? 'POST' : 'GET',
      ...(action === 'create' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not check Chrome profiles.');
    return data;
  }
  async function refresh() {
    const output = document.querySelector('#profiles-result');
    const list = document.querySelector('#profiles-installed');
    output.textContent = 'Reading Chrome profiles…';
    list.replaceChildren();
    try {
      const { profiles } = await request('list');
      for (const profile of profiles) {
        const item = document.createElement('li');
        item.textContent = `${profile.name} · ${profile.directory} · ${profile.verified ? 'Verified' : 'Saved files not yet verified'}`;
        list.append(item);
      }
      output.textContent = profiles.length ? `${profiles.length} saved profile${profiles.length === 1 ? '' : 's'} found.` : 'No saved Chrome profiles found. Install Chrome first if needed, then create a profile.';
    } catch (error) { output.textContent = error.message; }
  }
  async function verifyAll() {
    const button = document.querySelector('#profiles-verify-all');
    button.disabled = true;
    try { await Promise.all([refresh(), ...rows.map(row => row.run('verify'))]); }
    finally { button.disabled = false; }
  }
  document.querySelector('#profiles-verify-all').onclick = verifyAll;
  return { verifyAll };
}
