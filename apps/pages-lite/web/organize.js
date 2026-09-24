export const recentGroups = ['Last 5 mins', '5–10 mins ago', '10–30 mins ago', 'This evening', 'This afternoon', 'This morning', 'Overnight', 'Yesterday', '2–7 days ago', '8–30 days ago', 'Older', 'Never opened'];
export const fileKind = name => /\.html?$/i.test(name) ? 'HTML' : name.split('.').pop().toUpperCase();
const folder = name => name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
const baseName = name => name.split('/').pop();
const compare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
export function readRecent() {
  try {
    const value = JSON.parse(localStorage.getItem('pages-lite.recent') || '{}');
    return Object.fromEntries(Object.entries(value).filter(([, time]) => Number.isFinite(time) && time > 0));
  } catch { return {}; }
}
export function markOpened(name) {
  try { localStorage.setItem('pages-lite.recent', JSON.stringify({ ...readRecent(), [name]: Date.now() })); } catch {}
}
export function compareEntries(mode, recent = {}) {
  return (a, b) => {
    const byName = compare(baseName(a.name), baseName(b.name)) || compare(a.name, b.name);
    if (mode === 'name-desc') return -byName;
    if (mode === 'recent') return (recent[b.name] || 0) - (recent[a.name] || 0) || byName;
    if (mode === 'type') return compare(fileKind(a.name), fileKind(b.name)) || byName;
    if (mode === 'folder') return compare(folder(a.name), folder(b.name)) || byName;
    return byName;
  };
}
export function groupKey(name, mode, recent = {}, now = Date.now()) {
  if (mode === 'folder') return folder(name) || 'Main folder';
  if (mode === 'type') return fileKind(name);
  if (mode === 'initial') return Array.from(baseName(name))[0].toLocaleUpperCase();
  if (mode === 'recent') {
    const time = recent[name];
    if (!time) return 'Never opened';
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const week = new Date(today); week.setDate(week.getDate() - 7);
    const month = new Date(today); month.setDate(month.getDate() - 30);
    if (time >= +today) {
      const age = Math.max(0, now - time) / 60000;
      if (age < 5) return recentGroups[0];
      if (age < 10) return recentGroups[1];
      if (age < 30) return recentGroups[2];
      const hour = new Date(time).getHours();
      return hour >= 18 ? 'This evening' : hour >= 12 ? 'This afternoon' : hour >= 6 ? 'This morning' : 'Overnight';
    }
    return time >= +yesterday ? 'Yesterday' : time >= +week ? '2–7 days ago' : time >= +month ? '8–30 days ago' : 'Older';
  }
  return '';
}
