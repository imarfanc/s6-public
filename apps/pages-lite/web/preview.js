import { markdown } from './grid-markdown.js';

export const fileType = name => name.split('.').pop().toLowerCase().replace(/^htm$/, 'html');

export function preview(name, text) {
  const type = fileType(name);
  if (type === 'html') return text;
  if (type === 'md') return markdown(text);
  // A longer fence than anything in the file keeps its contents inside one code block.
  const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
  return markdown(`${fence}${type}\n${text}\n${fence}`);
}
