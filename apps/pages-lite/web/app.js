import { markOpened } from './organize.js';
import { markdown, escapeHTML } from './markdown.js';
import { standaloneURL } from './preview.js';
import { highlight } from './grid-markdown.js';
const $ = selector => document.querySelector(selector);
const api = '/api/apps/pages-lite/files';
let files = [], selected = '', filter = 'all', mode = 'preview', content = null, requestId = 0;
const type = name => name.split('.').pop().toLowerCase().replace(/^htm$/, 'html');
const kinds = {html: 'HTML', md: 'Markdown', toml: 'TOML', json: 'JSON'};
function preview(name, text) {
  if (type(name) === 'html') return text;
  if (type(name) === 'md') return markdown(text);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>:root{color-scheme:light dark}body{margin:0;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,monospace}</style><body><pre>${escapeHTML(text)}</pre></body></html>`;
}
function status(message) { $('#status').textContent = message; $('#status').hidden = !message; }
function view() {
  const standalone = $('#standalone');
  standalone.hidden = content === null;
  if (standalone.hidden) standalone.removeAttribute('href');
  else standalone.href = standaloneURL(selected);
  $('#preview').hidden = content === null || mode !== 'preview';
  $('#source').hidden = content === null || mode !== 'source';
  $('#preview-mode').setAttribute('aria-pressed',mode === 'preview');
  $('#source-mode').setAttribute('aria-pressed',mode === 'source');
}
function list() {
  const visible = files.filter(name => (filter === 'all' || type(name) === filter) && name.toLowerCase().includes($('#search').value.toLowerCase()));
  $('#count').textContent = `${visible.length} of ${files.length} files`;
  $('#files').replaceChildren(...visible.map(name => {
    const button = document.createElement('button'); button.className='file'; button.setAttribute('aria-current',name === selected ? 'page' : 'false');
    const badge=document.createElement('span');badge.className='kind';badge.dataset.kind=type(name);badge.textContent=type(name);
    const label=document.createElement('span');label.className='file-name';label.textContent=name.split('/').pop();
    const folder=document.createElement('span');folder.className='file-path';folder.textContent=name.includes('/')?name.slice(0,name.lastIndexOf('/')):'';
    button.title=name;button.append(label,badge);if(folder.textContent)button.append(folder);button.onclick=()=>open(name);return button;
  }));
  if(!visible.length) {const p=document.createElement('p');p.className='muted';p.textContent=files.length?'No matching files. Try another search.':'No files yet. Add HTML, Markdown, TOML, or JSON to the data folder.';$('#files').append(p);}
}
async function get(url) {const response=await fetch(url,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error || 'Could not load files.');return data;}
async function open(name) {
  const id=++requestId;selected=name;content=null;list();view();$('#title').textContent=name;$('#kind').textContent=kinds[type(name)];$('#kind').dataset.kind=type(name);status('Loading document…');
  try {const data=await get(`${api}?file=${encodeURIComponent(name)}`);if(id!==requestId)return;content=data.content;markOpened(name);$('#source').innerHTML=highlight(content, type(name));$('#preview').srcdoc=preview(name, content);history.replaceState(null,'',`#${encodeURIComponent(name)}`);status('');view();}
  catch(error){if(id===requestId)status(error.message);}
}
async function refresh() {
  $('#refresh').disabled=true;++requestId;content=null;view();status('Reading data folder…');
  try {({files}=await get(api));list();let hash='';try{hash=decodeURIComponent(location.hash.slice(1));}catch{}const next=files.includes(selected)?selected:files.includes(hash)?hash:files[0];if(next)await open(next);else {selected='';$('#title').textContent='Choose a file';status('Add a file to the data folder, then refresh.');}}
  catch(error){status(error.message);$('#count').textContent='Files unavailable';}
  finally{$('#refresh').disabled=false;}
}
$('#search').oninput=list;
document.querySelectorAll('[data-filter]').forEach(button => button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b===button));list();});
$('#preview-mode').onclick=()=>{mode='preview';view();};$('#source-mode').onclick=()=>{mode='source';view();};$('#refresh').onclick=refresh;
await refresh();
