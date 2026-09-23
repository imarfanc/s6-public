// Deliberately small Markdown subset; raw HTML remains text.
export const escapeHTML = (text) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(text) {
  return text.split(/(`[^`]+`)/g).map(part => part.startsWith('`') ? `<code>${escapeHTML(part.slice(1,-1))}</code>` : escapeHTML(part)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')).join('');
}
// Small tokenizer: comments, strings, numbers, shell variables and common keywords.
// Escape every token before adding markup; document text never becomes executable HTML.
export function highlight(code, language = '') {
  if (/^(html|htm|xml)$/i.test(language)) {
    return code.split(/(<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>)/g).map(part => {
      if (part.startsWith('<!--')) return `<span class="token-comment">${escapeHTML(part)}</span>`;
      if (!/^<\/?[A-Za-z!]/.test(part)) return escapeHTML(part);
      return `<span class="token-keyword">${part.split(/("[^"]*"|'[^']*')/g).map(piece =>
        /^["']/.test(piece) ? `<span class="token-string">${escapeHTML(piece)}</span>` : escapeHTML(piece)
      ).join('')}</span>`;
    }).join('');
  }
  const shell = /^(sh|bash|zsh|shell|console|python|py|ruby|rb|yaml|yml|toml)$/i.test(language);
  const tokens = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\#[^\n]*|\$[A-Za-z_][\w]*|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|function|return|if|else|for|while|of|in|async|await|import|from|export|class|new|true|false|null|undefined|def|print|do|done|then|fi|echo|sudo|SELECT|FROM|WHERE)\b)/g;
  return code.split(tokens).map(token => {
    let kind = '';
    if (/^["'`]/.test(token)) kind = 'string';
    else if (/^(\/\/|\/\*)/.test(token) || (shell && token.startsWith('#'))) kind = 'comment';
    else if (/^\$/.test(token)) kind = 'variable';
    else if (/^\d/.test(token)) kind = 'number';
    else if (/^(const|let|var|function|return|if|else|for|while|of|in|async|await|import|from|export|class|new|true|false|null|undefined|def|print|do|done|then|fi|echo|sudo|SELECT|FROM|WHERE)$/.test(token)) kind = 'keyword';
    return kind ? `<span class="token-${kind}">${escapeHTML(token)}</span>` : escapeHTML(token);
  }).join('');
}
function codeBlock(lines, language) {
  return `<section class="code-block"><div class="code-bar"><span>${escapeHTML(language || 'Code')}</span><button class="copy-code" type="button" aria-label="Copy code block">Copy</button></div><pre><code>${highlight(lines.join('\n'), language)}</code></pre></section>`;
}
export function markdown(text) {
  const lines = text.replace(/\r\n?/g,'\n').split('\n');
  const output = []; let paragraph = []; let list = ''; let code = null; let language = ''; let fence = '';
  const flush = () => { if(paragraph.length) { output.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph=[]; } if(list) {output.push(`</${list}>`);list='';} };
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (marker && (code === null || (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()))) {
      flush();
      if (code !== null) { output.push(codeBlock(code, language)); code = null; }
      else { code = []; fence = marker[1]; language = marker[2].trim().split(/\s/)[0]; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    if (!line.trim()) {flush();continue;}
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const item = line.match(/^\s*(?:(- |\* )|(\d+\. ))(.+)$/);
    if (heading) {flush();output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);}
    else if(item) {const tag=item[2]?'ol':'ul';if(list!==tag){flush();list=tag;output.push(`<${tag}>`);}output.push(`<li>${inline(item[3])}</li>`);}
    else if(line.startsWith('> ')) {flush();output.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);}
    else if(/^---+$/.test(line)) {flush();output.push('<hr>');}
    else {if(list)flush();paragraph.push(line);}
  }
  flush(); if(code !== null)output.push(codeBlock(code, language));
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>:root{color-scheme:light dark;--accent:light-dark(#497866,#7fb79d);--ink:light-dark(#1f2b24,#e6ece5);--paper:light-dark(#fffdf7,#1e231f);--muted:light-dark(#6a7a6e,#9aa89d);--line:light-dark(#ded8c9,#333c35);--slab:light-dark(#f1eee2,#262d27)}body{max-width:68ch;margin:auto;padding:clamp(28px,6vw,64px) clamp(20px,5vw,40px);font:17px/1.75 system-ui,sans-serif;color:var(--ink);background:var(--paper);overflow-wrap:anywhere}h1,h2,h3,h4{font-family:Iowan Old Style,Palatino,Georgia,serif;line-height:1.25;letter-spacing:-.015em}h1{font-size:2.4em;margin:0 0 .5em}h2{font-size:1.5em;margin-top:1.8em}h3{font-size:1.2em;margin-top:1.6em}a{color:var(--accent);text-underline-offset:3px}pre{overflow:auto;padding:18px;background:var(--slab);border-radius:8px}code{font-size:.85em}blockquote{margin-inline:0;padding-left:22px;border-left:2px solid var(--accent);color:var(--muted);font-style:italic}hr{border:0;border-top:1px solid var(--line);margin:2.5em 0}li{margin:.3em 0}.code-block{margin:26px 0;border:1px solid var(--line);border-radius:8px;overflow:hidden}.code-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 12px;background:var(--slab);border-bottom:1px solid var(--line);font:11px/1.5 system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}.copy-code{font:inherit;letter-spacing:.07em;color:inherit;background:transparent;border:1px solid var(--line);padding:4px 10px;border-radius:5px;cursor:pointer}.copy-code:hover{color:var(--ink);border-color:var(--accent)}.copy-code:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.code-block pre{margin:0;border-radius:0;line-height:1.65}.token-comment{color:light-dark(#60715f,#a2b19d)}.token-string{color:light-dark(#8b421f,#e9b68f)}.token-keyword{color:light-dark(#7041a2,#c7a4ed)}.token-number{color:light-dark(#245f94,#8ec9ed)}.token-variable{color:light-dark(#8b5910,#ebcf8b)}@media(prefers-reduced-motion:reduce){*{transition-duration:.01ms!important}}</style><body>${output.join('\n')}</body></html>`;
}
