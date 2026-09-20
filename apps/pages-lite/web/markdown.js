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
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>:root{color-scheme:light dark}body{max-width:720px;margin:auto;padding:clamp(24px,6vw,60px);font:17px/1.8 system-ui;color:light-dark(#293b32,#e0e9e2);background:light-dark(#fffefa,#222824);overflow-wrap:anywhere}h1,h2,h3{font-family:Georgia,serif;line-height:1.25}h1{font-size:2.3em}a{color:light-dark(#376746,#a5d6b1)}pre{overflow:auto;padding:18px;background:light-dark(#eef1e9,#303a32);border-radius:8px}code{font-size:.85em}blockquote{border-left:3px solid #8ba58a;margin-inline:0;padding-left:20px}hr{border:0;border-top:1px solid #8ba58a}</style><body>${output.join('\n')}</body></html>`;
}
