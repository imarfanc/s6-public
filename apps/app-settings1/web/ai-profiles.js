import { icon } from './icons.js';

export function setupAiProfiles(select) {
  const tab = document.createElement('button');
  tab.id = 'ai-profiles-tab';
  tab.role = 'tab';
  tab.setAttribute('aria-controls', 'ai-profiles');
  tab.innerHTML = `${icon('lucide:sparkles')}Chrome Profiles AI`;
  tab.onclick = () => select('ai-profiles');
  document.querySelector('[role=tablist]').append(tab);

  const panel = document.createElement('article');
  panel.id = 'ai-profiles';
  panel.role = 'tabpanel';
  panel.setAttribute('aria-labelledby', tab.id);
  panel.innerHTML = `<div class="head"><h2>Chrome Profiles AI</h2><span class="badge">${icon('lucide:terminal')}Codex · computer use</span></div>
    <form class="body ai-form" novalidate>
      <p>Codex opens Chrome’s profile window and clicks through creating a profile while you watch. A script checks before and verifies after success. The AI stops at the first error and summarizes what happened with a timestamp.</p>
      <label class="ai-preset-label" for="ai-preset">Preset</label>
      <select id="ai-preset"><option value="">Custom settings</option><option value="local">Local profile · stay signed out</option><option value="sign-in">Google sign-in · example username</option></select>
      <label class="field"><input id="ai-name" maxlength="60" required autocomplete="off" placeholder=" "><span>Profile name</span></label>
      <fieldset class="choice"><legend>Google account</legend>
        <label><input type="radio" name="ai-account" value="sign-in">${icon('lucide:log-in')}Sign in</label>
        <label><input type="radio" name="ai-account" value="signed-out" checked>${icon('lucide:user-round-x')}Stay signed out</label>
      </fieldset>
      <div id="ai-account-field" hidden>
        <label class="field"><input id="ai-account" maxlength="254" autocomplete="username" inputmode="email" placeholder=" "><span>Email, phone or username</span></label>
        <p class="hint">Optional. Replace the example with your real Google account, or leave blank to enter it in Chrome. Codex stops on errors or when your input is needed, and prints a timestamped summary.</p>
      </div>
      <div class="profile-actions"><button class="primary run" type="submit">${icon('lucide:square-terminal')}Run in Terminal</button><button type="button" id="ai-verify">${icon('lucide:circle-check')}Verify</button></div>
      <p class="manual">Requires a signed-in Codex CLI and Codex Computer Use. Runs Codex Luna (max effort) in full-access mode for this run. Codex never types passwords or codes.</p>
    </form>
    <div class="foot"><output id="ai-result" aria-live="polite"></output></div>`;
  document.querySelector('#settings').append(panel);

  const form = panel.querySelector('form');
  const name = panel.querySelector('#ai-name');
  const account = panel.querySelector('#ai-account');
  const accountField = panel.querySelector('#ai-account-field');
  const output = panel.querySelector('#ai-result');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('app-settings1.ai-profile')) ?? {}; } catch { /* optional */ }
  name.value = typeof saved.name === 'string' ? saved.name : 'Personal';
  if (saved.signIn === true) form.elements['ai-account'].value = 'sign-in';
  const signingIn = () => form.elements['ai-account'].value === 'sign-in';
  const sync = () => {
    accountField.hidden = !signingIn();
    // The account is not stored: it is personal data and only needed for this run.
    try { localStorage.setItem('app-settings1.ai-profile', JSON.stringify({ name: name.value, signIn: signingIn() })); } catch { /* optional */ }
  };
  const preset = panel.querySelector('#ai-preset');
  preset.onchange = () => {
    if (preset.value === 'local') { name.value = 'Personal'; account.value = ''; form.elements['ai-account'].value = 'signed-out'; }
    if (preset.value === 'sign-in') { name.value = 'Work'; account.value = 'your.name@example.com'; form.elements['ai-account'].value = 'sign-in'; }
    account.setCustomValidity('');
    output.textContent = preset.value === 'sign-in' ? 'Example only: replace your.name@example.com with your Google account, or clear it to enter the account yourself in Chrome.' : '';
    sync();
  };
  form.oninput = (event) => { if (event.target !== preset) preset.value = ''; account.setCustomValidity(''); sync(); };
  sync();

  let busy = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy || !name.reportValidity()) return;
    account.setCustomValidity(signingIn() && account.value.trim().toLowerCase() === 'your.name@example.com' ? 'Replace this example username with your Google account, or leave it blank.' : '');
    if (signingIn() && !account.reportValidity()) return;
    busy = true;
    form.querySelectorAll('input,button,select').forEach(control => control.disabled = true);
    output.textContent = 'Opening Terminal…';
    delete output.dataset.state;
    try {
      const response = await fetch('/api/apps/app-settings1/chrome-profiles/ai-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value.trim(), signIn: signingIn(), account: signingIn() ? account.value.trim() || null : null }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start the AI run.');
      output.textContent = `${data.message} Click Verify when the run finishes.`;
      delete output.dataset.state;
    } catch (error) { output.textContent = error.message; output.dataset.state = 'bad'; }
    finally { busy = false; form.querySelectorAll('input,button,select').forEach(control => control.disabled = false); }
  };

  panel.querySelector('#ai-verify').onclick = async () => {
    if (busy || !name.reportValidity()) return;
    busy = true;
    const trimmed = name.value.trim();
    output.textContent = 'Verifying…';
    delete output.dataset.state;
    try {
      const response = await fetch(`/api/apps/app-settings1/chrome-profiles/verify?name=${encodeURIComponent(trimmed)}`, { signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not check Chrome profiles.');
      output.textContent = data.verified ? `Verified: ${trimmed}. Saved in ${data.directory}.` : data.exists ? `Pending: ${trimmed} is listed but not saved yet. Finish setup in Chrome, then verify again.` : `Not found: ${trimmed}. Run it in Terminal, or finish setup in Chrome and verify again.`;
      output.dataset.state = data.verified ? 'ok' : data.exists ? 'pending' : 'bad';
    } catch (error) { output.textContent = error.message; output.dataset.state = 'bad'; }
    finally { busy = false; }
  };
}
