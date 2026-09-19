// Names are written as `prefix:name` so `deno task icons` finds them and vendors them into the sprite.
export function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="/shared/icons.svg#${name.replace(':', '--')}"/></svg>`;
}
