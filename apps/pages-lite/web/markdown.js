// Deliberately small Markdown subset; raw HTML remains text.
export const escapeHTML = (text) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(text) {
  return text.split(/(`[^`]+`)/g).map(part => part.startsWith('`') ? `<code>${escapeHTML(part.slice(1,-1))}</code>` : escapeHTML(part)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')).join('');
}
export function markdown(text) {
  const lines = text.replace(/\r\n?/g,'\n').split('\n');
  const output = []; let paragraph = []; let list = ''; let code = null;
  const flush = () => { if(paragraph.length) { output.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph=[]; } if(list) {output.push(`</${list}>`);list='';} };
  for (const line of lines) {
    if (line.startsWith('```')) { flush(); if(code !== null) {output.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`); code=null;} else code=[]; continue; }
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
  flush(); if(code !== null)output.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>:root{color-scheme:light dark;--accent:light-dark(#497866,#86bfa3);--ink:light-dark(#1c2620,#e3e9e3);--paper:light-dark(#fffdf8,#191e1a);--muted:light-dark(#5c6a60,#95a399);--line:light-dark(#dcd6c7,#29312b);--slab:light-dark(#f1eee2,#262d27)}body{max-width:68ch;margin:auto;padding:clamp(28px,6vw,64px) clamp(20px,5vw,40px);font:17px/1.75 system-ui,sans-serif;color:var(--ink);background:var(--paper);overflow-wrap:anywhere}h1,h2,h3,h4{font-family:Iowan Old Style,Palatino,Georgia,serif;line-height:1.25;letter-spacing:-.015em}h1{font-size:2.4em;margin:0 0 .5em}h2{font-size:1.5em;margin-top:1.8em}h3{font-size:1.2em;margin-top:1.6em}a{color:var(--accent);text-underline-offset:3px}pre{overflow:auto;padding:18px;background:var(--slab);border-radius:8px}code{font-size:.85em}blockquote{margin-inline:0;padding-left:22px;border-left:2px solid var(--accent);color:var(--muted);font-style:italic}hr{border:0;border-top:1px solid var(--line);margin:2.5em 0}li{margin:.3em 0}@media(prefers-reduced-motion:reduce){*{transition-duration:.01ms!important}}</style><body>${output.join('\n')}</body></html>`;
}
