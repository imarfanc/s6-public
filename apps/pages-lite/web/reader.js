import { fileType, preview } from './preview.js';
const name = new URL(location.href).searchParams.get('file');
document.title = name || 'Page reader';
try {
  if (!name) throw new Error('No file selected.');
  const response = await fetch(`/api/apps/pages-lite/files?file=${encodeURIComponent(name)}`, {cache:'no-store'});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not read this file.');
  if (fileType(name) !== 'html') {
    const rendered = new DOMParser().parseFromString(preview(name, data.content), 'text/html');
    document.head.append(...rendered.head.querySelectorAll('style'));
    document.body.replaceChildren(...rendered.body.childNodes);
    document.querySelectorAll('.copy-code').forEach(button => button.addEventListener('click', async () => {
      const text = fileType(name) === 'md' ? button.closest('.code-block').querySelector('code').textContent : data.content;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied!';
      } catch {
        const area = document.createElement('textarea'); area.value = text;
        area.style.cssText = 'position:fixed;opacity:0'; document.body.append(area); area.select();
        const copied = document.execCommand('copy'); area.remove(); button.focus();
        button.textContent = copied ? 'Copied!' : 'Select code to copy';
      }
      setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    }));
  } else {
    const frame = document.createElement('iframe'); frame.title = name;
    frame.setAttribute('sandbox', fileType(name) === 'html' ? 'allow-scripts' : ''); frame.srcdoc = preview(name, data.content);
    document.body.replaceChildren(frame);
  }
} catch (error) {
  document.querySelector('#status').textContent = error.message;
}
