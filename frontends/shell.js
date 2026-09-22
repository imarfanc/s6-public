/**
 * The app browser.
 *
 * Plain ES modules, no build step and no dependencies. App metadata arrives
 * already parsed from `GET /api/apps`, so nothing here knows about YAML.
 * Shared knobs live in `shared/config.ts` and are served as `/shared/config.js`.
 */
import { frontend } from "/shared/config.js";
import {
  buildHistoryTree,
  childLabel,
  isLightBackground,
  matchesSearch,
  nextIn,
  pathKey,
  spriteId,
} from "/shared/shell-lib.js";

/* ---- Tuning -------------------------------------------------------
   The knobs, and the values that have to agree with something outside
   this script. Site name, storage key, sprite URL, and default icons
   come from `shared/config.ts`. Nothing here is state. */

/** Everything the frontend remembers, under one localStorage key. */
const STORAGE_KEY = frontend.storageKey;
/** The discovery document: appspaces, sections, and every app. */
const API_URL = frontend.apiApps;
const ALL_APPSPACE = "All";
/** Fetched and inlined at boot, because <use> will not follow a URL. */
const SPRITE_URL = frontend.spriteUrl;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Sidebar widths, in the order #sidebar-toggle cycles them. */
const SIZES = ["wide", "wide2", "collapsed"];
/** Tree indent steps, in the order `d` cycles them. See #sidebar[data-indent]. */
const INDENTS = ["roomy", "tight", "flat"];
/** How long writes to `state` are batched before they are stored. */
const SAVE_DELAY = 250;
/** Must stay in step with the @media breakpoint in the stylesheet. */
const MOBILE_QUERY = frontend.mobileQuery;
/** Refresh relative ages and history from other sessions. */
const HISTORY_REFRESH = 30000;
const HISTORY_URL = "/api/shell-history";
const TOOLTIP_HIDE_DELAY = 150;

/* Used when app.yaml or sections-metadata.yaml leaves a field out.
   Names must exist in the sprite — run `deno task icons` after changing
   one in `shared/config.ts`, or it renders as blank space. */
const DEFAULT_APPSPACE_ICON = frontend.defaultAppspaceIcon;
const DEFAULT_SECTION_ICON = frontend.defaultSectionIcon;
const DEFAULT_APP_ICON = frontend.defaultAppIcon;
const DEFAULT_APP_COLOR = frontend.defaultAppColor;
const DEFAULT_CHILD_ICON = frontend.defaultChildIcon;
const CHEVRON_ICON = frontend.chevronIcon;
const EXTERNAL_ICON = frontend.externalIcon;
const LOCK_ICON = frontend.lockIcon;
const KMTRIGGER_FILE = frontend.kmtriggerFile;
const KMTRIGGER_FOLDER = frontend.kmtriggerFolder;

/* How hard an app's accent tints the shell, in percent. TINT_TOP and
   TINT_BOTTOM are the ends of the glass gradient; ACCENT_MIX is the
   hover and selected-row wash. Raise all three for a bolder shell. */
const TINT_TOP = 18;
const TINT_BOTTOM = 7;
const ACCENT_MIX = 20;
/** Perceived luminance above which a preview counts as light. */
const LIGHT_TONE_THRESHOLD = 0.55;
/** An app posts this to say it repainted its own background. */
const PREVIEW_BG_MESSAGE = "gallery-preview-bg-changed";
/* ------------------------------------------------------------------ */

const refs = {
  sprite: document.querySelector("#icon-sprite"),
  sidebar: document.querySelector("#sidebar"),
  rootCycle: document.querySelector("#root-cycle"),
  rootIcon: document.querySelector("#root-icon"),
  rootName: document.querySelector("#root-name"),
  rootDescription: document.querySelector("#root-description"),
  rootMenuToggle: document.querySelector("#root-menu-toggle"),
  rootMenu: document.querySelector("#root-menu"),
  appspaceLock: document.querySelector("#appspace-lock"),
  appspaceAuth: document.querySelector("#appspace-auth"),
  appspaceAuthForm: document.querySelector("#appspace-auth-form"),
  appspaceAuthTitle: document.querySelector("#appspace-auth-title"),
  appspaceAuthCopy: document.querySelector("#appspace-auth-copy"),
  appspaceAuthPassword: document.querySelector("#appspace-auth-password"),
  appspaceAuthError: document.querySelector("#appspace-auth-error"),
  appspaceAuthCancel: document.querySelector("#appspace-auth-cancel"),
  search: document.querySelector("#search"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
  expandToggle: document.querySelector("#expand-toggle"),
  tree: document.querySelector("#sidebar-tree"),
  tooltip: document.querySelector("#app-tooltip"),
  help: document.querySelector("#help-dialog"),
  previewFrame: document.querySelector("#preview-frame"),
  previewEmpty: document.querySelector("#preview-empty"),
  previewAppspace: document.querySelector("#preview-appspace"),
  toggle: document.querySelector("#sidebar-toggle"),
  backdrop: document.querySelector("#sidebar-backdrop"),
};

document.title = frontend.title;
refs.previewAppspace.textContent = frontend.title;

const defaultState = {
  selectedAppspace: null,
  view: "tree",
  width: "wide",
  indent: "roomy",
  viewIndents: {},
  search: "",
  useFolderNames: false,
  collapsed: [],
  recent: [],
  opened: {},
  pendingHistory: {},
  activeApp: null,
  /** Which of the active app's `children:` pages is open, if any. */
  activeChild: null,
};

let manifest = null;
let apps = [];
let state = loadState();
let grants = new Set();
let authPrompt = null;
let tooltipAnchor = null;
let tooltipHideTimer = null;

function loadState() {
  try {
    return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return { ...defaultState };
  }
}

/**
 * Writes are batched.
 *
 * `state.search` alone calls this on every keystroke, which costs nothing
 * against localStorage and will cost a round trip against a database. Call
 * it as often as you like; `flushState` runs on the way out so nothing
 * pending is lost.
 */
let saveTimer = null;

function writeState() {
  saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* State remains available for this page load. */ }
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeState, SAVE_DELAY);
}

function flushState() {
  if (saveTimer !== null) writeState();
}

/**
 * A cloned icon brings the sprite's own gradient ids with it, and the
 * duplicate makes `url(#…)` resolve to the copy still sitting inside the
 * hidden sprite — which paints nothing. Renaming them per clone is what
 * makes a multicolour icon appear at all. Most icons have no ids, so this
 * costs one empty query.
 */
function isolateIds(svg, serial) {
  const renamed = new Map();
  for (const node of svg.querySelectorAll("[id]")) {
    const from = node.id;
    const to = `${from}-${serial}`;
    renamed.set(from, to);
    node.id = to;
  }
  if (!renamed.size) return;
  for (const node of svg.querySelectorAll("*")) {
    for (const attribute of node.attributes) {
      for (const [from, to] of renamed) {
        if (attribute.value.includes(`#${from}`)) {
          attribute.value = attribute.value.replaceAll(`#${from}`, `#${to}`);
        }
      }
    }
  }
}

let iconSerial = 0;

/**
 * One icon, cloned out of the sprite.
 *
 * `<use href="#id">` would be the obvious way and was, until a multicolour
 * icon arrived: a path painted `fill="url(#gradient)"` renders nothing
 * inside a <use> shadow tree in Chrome, so most of a gradient logo silently
 * disappears. Cloning the symbol's children paints them normally, and
 * carrying the symbol's own viewBox across keeps a non-square icon from
 * being cropped to fit the square box it is drawn in.
 */
function icon(name, className = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `icon ${className}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const symbol = refs.sprite.querySelector(`#${CSS.escape(spriteId(name))}`);
  if (symbol) {
    svg.setAttribute("viewBox", symbol.getAttribute("viewBox"));
    svg.append(...[...symbol.children].map((child) => child.cloneNode(true)));
    isolateIds(svg, ++iconSerial);
  }
  return svg;
}

/**
 * Inline the sprite so `<use href="#id">` resolves. Browsers do not follow
 * `<use>` into an external file, so fetching and injecting is the portable way
 * to keep the icons in one cacheable document.
 */
async function loadSprite() {
  try {
    const response = await fetch(SPRITE_URL);
    if (response.ok) refs.sprite.innerHTML = await response.text();
  } catch { /* Icons degrade to blank space; the labels still read fine. */ }
}

function appspaceOptions() {
  return [
    { name: ALL_APPSPACE, sections: manifest?.appspaces ?? [] },
    ...(manifest?.appspaces ?? []),
  ];
}

function currentAppspace() {
  if (state.selectedAppspace === ALL_APPSPACE) return appspaceOptions()[0];
  return manifest?.appspaces.find((item) => item.name === state.selectedAppspace) ??
    manifest?.appspaces[0];
}

function appspaceByName(name) {
  return manifest?.appspaces.find((item) => item.name === name) ?? null;
}

function isUnlocked(name) {
  const appspace = appspaceByName(name);
  return !appspace?.locked || grants.has(name);
}

function firstUnlockedAppspace() {
  return manifest?.appspaces.find((item) => !item.locked || grants.has(item.name)) ??
    manifest?.appspaces[0] ??
    null;
}

function stripAuthQuery() {
  const url = new URL(location.href);
  if (!url.searchParams.has("auth")) return;
  url.searchParams.delete("auth");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function loadSession() {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    grants = new Set(body.grants ?? []);
  } catch { /* Grants stay empty; locked appspaces will prompt. */ }
}

function showAuthError(message) {
  refs.appspaceAuthError.hidden = !message;
  refs.appspaceAuthError.textContent = message || "";
}

function promptAppspaceAuth(appspace) {
  if (authPrompt) return authPrompt;
  authPrompt = new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      refs.appspaceAuth.removeEventListener("close", onClose);
      refs.appspaceAuthForm.removeEventListener("submit", onSubmit);
      refs.appspaceAuthCancel.removeEventListener("click", onCancel);
      if (refs.appspaceAuth.open) refs.appspaceAuth.close();
      authPrompt = null;
      resolve(ok);
    };
    const onClose = () => finish(false);
    const onCancel = () => finish(false);
    const onSubmit = async (event) => {
      event.preventDefault();
      showAuthError("");
      try {
        const response = await fetch("/api/auth/appspace/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            appspace: appspace.name,
            password: refs.appspaceAuthPassword.value,
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          showAuthError(body?.error || `Could not unlock (${response.status}).`);
          return;
        }
        grants.add(appspace.name);
        finish(true);
      } catch (error) {
        showAuthError(error?.message || "Could not unlock.");
      }
    };
    refs.appspaceAuthTitle.textContent = `Unlock ${appspace.name}`;
    refs.appspaceAuthCopy.textContent = `Enter the password for the ${appspace.name} appspace.`;
    refs.appspaceAuthPassword.value = "";
    showAuthError("");
    refs.appspaceAuth.addEventListener("close", onClose);
    refs.appspaceAuthForm.addEventListener("submit", onSubmit);
    refs.appspaceAuthCancel.addEventListener("click", onCancel);
    refs.appspaceAuth.showModal();
    refs.appspaceAuthPassword.focus();
  });
  return authPrompt;
}

async function ensureAppspaceGrant(name) {
  const appspace = appspaceByName(name);
  if (!appspace?.locked) return true;
  if (grants.has(name)) return true;
  return await promptAppspaceAuth(appspace);
}

async function lockAppspace(name) {
  const appspace = appspaceByName(name);
  if (!appspace?.locked || !grants.has(name)) return;
  try {
    await fetch("/api/auth/appspace/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ appspace: appspace.name }),
    });
  } catch { /* Cookie may already be gone; drop the local grant anyway. */ }
  grants.delete(name);
  if (state.selectedAppspace === name) {
    const fallback = firstUnlockedAppspace();
    state = {
      ...state,
      selectedAppspace: fallback?.name ?? null,
      activeApp: null,
      activeChild: null,
    };
    showAppspaceLanding();
    saveState();
  }
  setRootMenu(false);
  renderRoot();
  renderTree();
}

function rootApps() {
  if (state.selectedAppspace === ALL_APPSPACE) return apps;
  return apps.filter((app) => app.appspace === currentAppspace()?.name);
}

function setRootMenu(open) {
  refs.rootMenu.hidden = !open;
  refs.rootMenuToggle.setAttribute("aria-expanded", String(open));
}

function renderRoot() {
  const root = currentAppspace();
  if (!root) return;
  refs.rootName.textContent = root.name;
  const count = rootApps().length;
  refs.rootDescription.textContent = `${count} app${count === 1 ? "" : "s"}`;

  // Header icon: redraw the glyph, and tint the badge behind it only when
  // the appspace actually declares a colour.
  refs.rootIcon.replaceChildren(icon(root.icon || DEFAULT_APPSPACE_ICON));
  refs.rootIcon.dataset.tinted = String(Boolean(root.color));
  refs.rootIcon.style.setProperty("--root-tint", root.color || "");

  refs.appspaceLock.hidden = !manifest.appspaces.some((item) => item.locked);
  refs.appspaceLock.replaceChildren(icon(LOCK_ICON));

  refs.rootMenu.replaceChildren();
  for (const appspace of appspaceOptions()) {
    const button = document.createElement("button");
    button.id = `appspace-${appspace.name}-option`;
    button.className = `menu-btn${appspace.name === root.name ? " is-active" : ""}`;
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(appspace.name === root.name));
    const glyph = icon(appspace.icon || DEFAULT_APPSPACE_ICON);
    if (appspace.color) glyph.style.color = appspace.color;
    button.append(glyph);
    const label = document.createElement("span");
    label.className = "truncate";
    label.textContent = appspace.name;
    button.append(label);
    if (appspace.locked) {
      const granted = grants.has(appspace.name);
      const mark = icon(LOCK_ICON, "lock-mark");
      mark.setAttribute("title", granted ? "Lock this appspace" : "Locked");
      button.append(mark);
    }
    button.addEventListener("click", (event) => {
      if (
        appspace.locked && grants.has(appspace.name) &&
        event.target.closest?.(".lock-mark")
      ) {
        void lockAppspace(appspace.name);
        return;
      }
      void selectAppspace(appspace.name);
    });
    refs.rootMenu.append(button);
  }
}

async function selectAppspace(name) {
  if (!(await ensureAppspaceGrant(name))) return;
  state = { ...state, selectedAppspace: name, activeApp: null, activeChild: null };
  setRootMenu(false);
  showAppspaceLanding();
  saveState();
  renderRoot();
  renderTree();
}

/** The entry after `current`, wrapping — and the first one if `current`
    is not in the list, which is what a stale stored value looks like. */
function cycleThrough(names) {
  if (!names.length) return;
  void selectAppspace(nextIn(names, currentAppspace()?.name));
}

function cycleAppspace() {
  cycleThrough(
    appspaceOptions().filter((item) => !item.locked).map((item) => item.name),
  );
}

function cycleLockedAppspace() {
  cycleThrough(
    (manifest?.appspaces ?? []).filter((item) => item.locked).map((item) => item.name),
  );
}

function countApps(section, appspace, parents, byPath) {
  const path = [...parents, section.name];
  return (byPath.get(pathKey(appspace, path)) ?? []).length +
    section.sections.reduce(
      (total, child) => total + countApps(child, appspace, path, byPath),
      0,
    );
}

function descendantSectionIds(section, appspace, parents) {
  const path = [...parents, section.name];
  return section.sections.flatMap((child) => [
    pathKey(appspace, [...path, child.name]),
    ...descendantSectionIds(child, appspace, path),
  ]);
}

function cycleSection(section, appspace, parents) {
  const sectionId = pathKey(appspace, [...parents, section.name]);
  const descendants = descendantSectionIds(section, appspace, parents);
  cycleGroup(sectionId, descendants);
}

function cycleGroup(sectionId, descendants) {
  const collapsed = new Set(state.collapsed);

  if (collapsed.has(sectionId)) {
    collapsed.delete(sectionId);
    for (const id of descendants) collapsed.add(id);
  } else if (descendants.some((id) => collapsed.has(id))) {
    for (const id of descendants) collapsed.delete(id);
  } else {
    collapsed.add(sectionId);
    for (const id of descendants) collapsed.add(id);
  }

  state.collapsed = [...collapsed];
  saveState();
  syncCollapsed();
}

/**
 * The `children:` rows for one app, or null when it declares none.
 *
 * Kept separate from renderApp so that an app without children produces
 * exactly the markup it always did — one .app-row, no wrapper.
 */
function renderAppChildren(app) {
  if (!app.children?.length) return null;

  const children = document.createElement("div");
  children.id = `app-${app.id}-children`;
  children.className = "app-children";

  app.children.forEach((file, index) => {
    const row = document.createElement("button");
    row.id = `app-${app.id}-child-${index}`;
    row.className = `child-row${
      state.activeApp === app.id && state.activeChild === file ? " is-active" : ""
    }`;
    row.type = "button";
    row.style.setProperty("--item-color", app.color || DEFAULT_APP_COLOR);
    row.append(icon(DEFAULT_CHILD_ICON, "child-row__icon"));
    const label = document.createElement("span");
    label.className = "child-row__label";
    label.textContent = childLabel(file);
    row.append(label);
    row.title = file;
    row.addEventListener("click", () => {
      void openApp(app, true, file);
    });
    children.append(row);
  });

  return children;
}

function cancelTooltipHide() {
  if (tooltipHideTimer === null) return;
  clearTimeout(tooltipHideTimer);
  tooltipHideTimer = null;
}

function hideTooltipNow() {
  cancelTooltipHide();
  refs.tooltip.hidden = true;
  tooltipAnchor = null;
}

function scheduleTooltipHide() {
  cancelTooltipHide();
  tooltipHideTimer = setTimeout(hideTooltipNow, TOOLTIP_HIDE_DELAY);
}

function tooltipText(className, text, tagName = "div") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function keyboardMaestroHref(template, name, path) {
  return template.replaceAll("{name}", name).replaceAll("{path}", encodeURIComponent(path));
}

function tooltipAction(label, href, path, iconName, folder = false) {
  const action = document.createElement("a");
  action.className = `app-tooltip__action${folder ? " app-tooltip__action--folder" : ""}`;
  action.href = href;
  action.title = `${label}: ${path}`;
  action.append(icon(iconName), document.createTextNode(label));
  return action;
}

function appTooltipContent(app) {
  const fragment = document.createDocumentFragment();
  const header = document.createElement("div");
  header.className = "app-tooltip__header";
  const glyph = document.createElement("span");
  glyph.className = "app-tooltip__icon";
  glyph.append(icon(app.icon || DEFAULT_APP_ICON));
  header.append(glyph, tooltipText("app-tooltip__name", app.name, "strong"));
  fragment.append(header);

  if (app.description) {
    fragment.append(tooltipText("app-tooltip__description", app.description));
  }
  if (app.tags.length) {
    const tags = document.createElement("div");
    tags.className = "app-tooltip__tags";
    for (const tag of app.tags) tags.append(tooltipText("", tag, "span"));
    fragment.append(tags);
  }

  const path = document.createElement("div");
  path.className = "app-tooltip__path";
  [app.appspace, ...app.sections, app.name].forEach((part, index) => {
    if (index) path.append(tooltipText("", "›", "b"));
    path.append(tooltipText("", part, "span"));
  });
  fragment.append(path);
  fragment.append(tooltipText("app-tooltip__folder", `apps/${app.path}`, "code"));

  const updated = parseTimestamp(app.updated);
  if (updated !== null) {
    const line = tooltipText("app-tooltip__updated", "Updated ");
    const time = document.createElement("time");
    time.dateTime = app.updated;
    time.textContent = new Date(updated).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    line.append(time);
    fragment.append(line);
  }

  /* `store:` is the /api/data/ namespace. No `store:` is read as "this app
     saves nothing" and the row is left out — the server would fall back to
     the app's id, but that is a fallback for an app that forgot the field,
     not a namespace worth advertising on one that never writes. */
  if (app.store) {
    const line = document.createElement("div");
    line.className = "app-tooltip__store";
    const key = document.createElement("code");
    key.textContent = `${app.store}/`;
    line.append(tooltipText("", "Storage", "span"), key);
    fragment.append(line);
  }

  /* Checkout comes from GET /api/apps so a rename or a different clone
     does not need a frontend edit. URL templates are `KMTRIGGER_FILE`
     and `KMTRIGGER_FOLDER` in shared/config.ts. Absent on Val Town. */
  const checkout = manifest?.checkout;
  if (checkout?.root && checkout.name) {
    const folderPath = `${checkout.root}/apps/${app.path}`;
    const filePath = `${folderPath}/app.yaml`;
    const actions = document.createElement("div");
    actions.className = "app-tooltip__actions";
    actions.append(
      tooltipAction(
        "Open app.yaml",
        keyboardMaestroHref(KMTRIGGER_FILE, checkout.name, filePath),
        filePath,
        DEFAULT_CHILD_ICON,
      ),
      tooltipAction(
        "Open folder",
        keyboardMaestroHref(KMTRIGGER_FOLDER, checkout.name, folderPath),
        folderPath,
        DEFAULT_SECTION_ICON,
        true,
      ),
    );
    fragment.append(actions);
  }
  return fragment;
}

function positionTooltip(anchor) {
  if (refs.tooltip.hidden) return;
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = refs.tooltip.getBoundingClientRect();
  const gap = 4;
  const edge = 8;
  let left = anchorRect.right + gap;
  if (left + tooltipRect.width > innerWidth - edge) {
    left = anchorRect.left - tooltipRect.width - gap;
  }
  left = Math.max(edge, Math.min(left, innerWidth - tooltipRect.width - edge));
  const centeredTop = anchorRect.top + (anchorRect.height - tooltipRect.height) / 2;
  const top = Math.max(edge, Math.min(centeredTop, innerHeight - tooltipRect.height - edge));
  refs.tooltip.style.left = `${Math.round(left)}px`;
  refs.tooltip.style.top = `${Math.round(top)}px`;
  refs.tooltip.style.visibility = "visible";
}

function showTooltip(anchor) {
  const app = apps.find((candidate) => candidate.id === anchor.dataset.appId);
  if (!app) return;
  cancelTooltipHide();
  refs.tooltip.style.setProperty("--item-color", app.color || DEFAULT_APP_COLOR);
  refs.tooltip.replaceChildren(appTooltipContent(app));
  /* Unhide before measuring, but stay invisible until positionTooltip has
     a real box to work from — otherwise it paints at the previous spot. */
  refs.tooltip.hidden = false;
  refs.tooltip.style.visibility = "hidden";
  tooltipAnchor = anchor;
  positionTooltip(anchor);
}

function renderApp(app) {
  const row = document.createElement("div");
  row.id = `app-${app.id}`;
  row.className = `app-row${state.activeApp === app.id ? " is-active" : ""}`;
  row.style.setProperty("--item-color", app.color || DEFAULT_APP_COLOR);

  const select = document.createElement("button");
  select.id = `app-${app.id}-select`;
  select.className = "app-row__select";
  select.type = "button";
  select.append(icon(app.icon || DEFAULT_APP_ICON, "app-row__icon"));
  const label = document.createElement("span");
  label.className = "app-row__label";
  label.textContent = state.useFolderNames ? app.path.split("/").filter(Boolean).pop() : app.name;
  select.append(label);
  select.addEventListener("click", () => {
    void openApp(app);
  });

  const external = document.createElement("a");
  external.id = `app-${app.id}-external`;
  external.className = "app-row__external icon-button";
  external.href = app.url;
  external.target = "_blank";
  external.rel = "noopener";
  external.title = `Open ${app.name} in a new tab`;
  external.setAttribute("aria-label", external.title);
  external.setAttribute("aria-describedby", "app-tooltip");
  external.dataset.appId = app.id;
  external.append(icon(EXTERNAL_ICON));
  external.addEventListener("click", (event) => {
    event.preventDefault();
    void (async () => {
      if (!(await ensureAppspaceGrant(app.appspace))) return;
      recordOpening(app);
      open(app.url, "_blank", "noopener");
      renderTree();
    })();
  });

  row.append(select, external);

  const children = renderAppChildren(app);
  if (!children) return row;

  const group = document.createElement("div");
  group.id = `app-${app.id}-group`;
  group.className = "app-group";
  group.append(row, children);
  return group;
}

function renderSection(section, appspace, parents, byPath) {
  const path = [...parents, section.name];
  const sectionId = pathKey(appspace, path);
  const group = document.createElement("div");
  group.id = `section-${sectionId.replace(/[^a-z0-9]+/gi, "-")}`;
  group.className = "tree-group";
  group.dataset.sectionId = sectionId;
  // Only the app tree force-expands during a search; the updated tree does not.
  group.dataset.searchAware = "true";

  const button = document.createElement("button");
  button.className = "tree-row";
  button.type = "button";
  const collapsed = state.collapsed.includes(sectionId) && !state.search;
  button.setAttribute("aria-expanded", String(!collapsed));
  button.append(icon(CHEVRON_ICON, "tree-row__chevron"));
  button.append(icon(section.icon || DEFAULT_SECTION_ICON, "tree-row__icon"));
  button.style.setProperty("--item-color", section.color || "var(--muted)");
  const label = document.createElement("span");
  label.className = "tree-row__label";
  label.textContent = section.name;
  const count = document.createElement("span");
  count.className = "tree-row__count";
  count.textContent = countApps(section, appspace, parents, byPath);
  button.append(label, count);

  const children = document.createElement("div");
  children.className = "tree-children";
  children.hidden = collapsed;
  for (const app of byPath.get(pathKey(appspace, path)) ?? []) {
    if (matchesSearch(app, state.search)) children.append(renderApp(app));
  }
  for (const child of section.sections) {
    const rendered = renderSection(child, appspace, path, byPath);
    if (rendered.dataset.hasMatches === "true") children.append(rendered);
  }
  group.dataset.hasMatches = String(children.childElementCount > 0);
  button.addEventListener("click", () => cycleSection(section, appspace, parents));
  group.append(button, children);
  return group;
}

function appById(id) {
  if (!id) return null;
  return apps.find((app) => app.id === id || (app.aliases ?? []).includes(id)) ?? null;
}

function historyNodes() {
  return buildHistoryTree(
    rootApps().filter((app) => isUnlocked(app.appspace) && matchesSearch(app, state.search)),
    state.opened,
  );
}

let historySyncing = false;
let historyError = false;

function renderRecent() {
  if (historyError) {
    const status = document.createElement("p");
    status.id = "history-sync-status";
    status.setAttribute("role", "status");
    status.textContent =
      "History sync unavailable. Changes are saved on this browser and will retry.";
    refs.tree.append(status);
  }
  const nodes = historyNodes();
  if (!nodes.length) return renderEmpty("No recently opened apps.");
  for (const node of nodes) refs.tree.append(renderUpdatedNode(node));
}

function recordOpening(app) {
  state.opened[app.id] = Date.now();
  state.pendingHistory[app.id] = state.opened[app.id];
  saveState();
  void syncHistory();
}

/** Merge server timestamps and retry only unsaved openings, never replace remote history. */
async function syncHistory() {
  if (historySyncing || !manifest) return;
  historySyncing = true;
  const before = JSON.stringify(state.opened);
  const previousError = historyError;
  try {
    for (const [id, timestamp] of Object.entries(state.pendingHistory)) {
      const app = appById(id);
      if (!app || !isUnlocked(app.appspace)) continue;
      const response = await fetch(`${HISTORY_URL}/${app.path}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opened: timestamp }),
        keepalive: true,
      });
      if (!response.ok) throw new Error(`History save returned ${response.status}`);
      if (state.pendingHistory[id] === timestamp) delete state.pendingHistory[id];
    }
    const response = await fetch(HISTORY_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`History fetch returned ${response.status}`);
    const remote = await response.json();
    for (const [id, timestamp] of Object.entries(remote)) {
      if (appById(id) && Number.isFinite(timestamp) && timestamp >= 0) {
        state.opened[id] = Math.max(state.opened[id] || 0, timestamp);
      }
    }
    historyError = false;
  } catch (error) {
    historyError = true;
    console.warn("History sync failed", error);
  } finally {
    historySyncing = false;
    saveState();
    if (
      state.view === "recent" &&
      (before !== JSON.stringify(state.opened) || previousError !== historyError)
    ) refreshHistory();
  }
}

/** Preserve keyboard focus when time buckets change in the background. */
function refreshHistory() {
  if (state.view !== "recent" || document.hidden) return;
  const focused = refs.tree.contains(document.activeElement) ? document.activeElement : null;
  const id = focused?.id;
  const groupId = focused?.closest(".tree-group")?.id;
  const scroll = refs.tree.scrollTop;
  renderTree();
  const replacement = (id && document.getElementById(id)) ||
    (groupId && document.getElementById(groupId)?.querySelector("button"));
  if (focused) {
    (replacement || refs.viewButtons.find((button) => button.dataset.view === "recent"))
      ?.focus({ preventScroll: true });
  }
  refs.tree.scrollTop = scroll;
}

function parseTimestamp(value) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function dateKey(timestamp) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dayStart(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayLabel(timestamp) {
  const days = Math.floor((dayStart(Date.now()) - dayStart(timestamp)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function weekDetails(timestamp) {
  const date = new Date(timestamp);
  const start = new Date(date);
  const weekday = start.getDay();
  start.setDate(start.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  start.setHours(0, 0, 0, 0);
  const thursday = new Date(start);
  thursday.setDate(thursday.getDate() + 3);
  const year = thursday.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const week = Math.ceil((((thursday - yearStart) / 86_400_000) + 1) / 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const range = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${
    end.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }`;
  return { year, week, start: start.getTime(), label: `Week ${week} · ${range}` };
}

function buildUpdatedTree(appList) {
  const years = new Map();
  const undated = [];
  for (const app of appList) {
    const timestamp = parseTimestamp(app.updated);
    if (timestamp === null) {
      undated.push(app);
      continue;
    }
    const details = weekDetails(timestamp);
    const year = String(details.year);
    const week = `${year}-W${details.week}`;
    if (!years.has(year)) years.set(year, new Map());
    const weeks = years.get(year);
    if (!weeks.has(week)) weeks.set(week, { ...details, days: new Map() });
    const days = weeks.get(week).days;
    const key = dateKey(timestamp);
    if (!days.has(key)) days.set(key, { timestamp, apps: [] });
    days.get(key).apps.push(app);
  }

  const nodes = [...years.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([year, weeks]) => ({
      id: `updated:${year}`,
      label: year,
      icon: "mdi:calendar",
      apps: [],
      children: [...weeks.entries()].sort((a, b) => b[1].start - a[1].start)
        .map(([week, details]) => ({
          id: `updated:${week}`,
          label: details.label,
          icon: "mdi:calendar-range",
          apps: [],
          children: [...details.days.entries()]
            .sort((a, b) => b[1].timestamp - a[1].timestamp)
            .map(([day, details]) => ({
              id: `updated:${day}`,
              label: dayLabel(details.timestamp),
              icon: "mdi:calendar-blank",
              apps: details.apps.sort((a, b) =>
                (a.sort_name || a.name).localeCompare(b.sort_name || b.name)
              ),
              children: [],
            })),
        })),
    }));
  if (undated.length) {
    nodes.push({
      id: "updated:undated",
      label: "Undated",
      icon: "mdi:calendar-question",
      apps: undated,
      children: [],
    });
  }
  return nodes;
}

function updatedNodeCount(node) {
  return node.apps.length +
    node.children.reduce((total, child) => total + updatedNodeCount(child), 0);
}

function renderUpdatedNode(node) {
  const group = document.createElement("div");
  group.id = node.id.replace(/[^a-z0-9]+/gi, "-");
  group.className = "tree-group";
  group.dataset.sectionId = node.id;
  const button = document.createElement("button");
  button.className = "tree-row";
  button.type = "button";
  const collapsed = state.collapsed.includes(node.id);
  button.setAttribute("aria-expanded", String(!collapsed));
  button.append(icon(CHEVRON_ICON, "tree-row__chevron"));
  button.append(icon(node.icon, "tree-row__icon"));
  const label = document.createElement("span");
  label.className = "tree-row__label";
  label.textContent = node.label;
  const count = document.createElement("span");
  count.className = "tree-row__count";
  count.textContent = updatedNodeCount(node);
  button.append(label, count);

  const children = document.createElement("div");
  children.className = "tree-children";
  children.hidden = collapsed;
  for (const app of node.apps) children.append(renderApp(app));
  for (const child of node.children) children.append(renderUpdatedNode(child));
  button.addEventListener("click", () => {
    const descendantIds = (parent) =>
      parent.children.flatMap((child) => [
        child.id,
        ...descendantIds(child),
      ]);
    cycleGroup(node.id, descendantIds(node));
  });
  group.append(button, children);
  return group;
}

function renderUpdated() {
  const nodes = buildUpdatedTree(
    rootApps().filter((app) => matchesSearch(app, state.search)),
  );
  if (!nodes.length) return renderEmpty("No updated apps.");
  for (const node of nodes) refs.tree.append(renderUpdatedNode(node));
}

function renderEmpty(message) {
  const empty = document.createElement("p");
  empty.id = "sidebar-empty";
  empty.textContent = message;
  refs.tree.append(empty);
}

/**
 * Apply `state.collapsed` to the tree already on screen.
 *
 * Collapsing cannot change anything a re-render would compute differently —
 * labels, counts, ordering and the app rows are all identical either side of
 * it — so the two attributes are flipped in place instead. That is not just
 * cheaper, it is the only version that behaves: rebuilding destroys the
 * button that was just clicked, which drops keyboard focus to <body> and
 * denies the chevron's `transition: transform .2s` any chance to run.
 */
function syncCollapsed() {
  for (const group of refs.tree.querySelectorAll(".tree-group")) {
    const forceOpen = group.dataset.searchAware === "true" && Boolean(state.search);
    const collapsed = state.collapsed.includes(group.dataset.sectionId) && !forceOpen;
    group.querySelector(":scope > .tree-row")
      ?.setAttribute("aria-expanded", String(!collapsed));
    const children = group.querySelector(":scope > .tree-children");
    if (children) children.hidden = collapsed;
  }
}

function renderTree() {
  hideTooltipNow();
  refs.sidebar.dataset.indent = state.viewIndents[state.view] ?? state.indent;
  refs.tree.replaceChildren();
  refs.viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  if (state.view === "recent") return renderRecent();
  if (state.view === "updated") return renderUpdated();

  const root = currentAppspace();
  if (!root) return renderEmpty("No appspaces found.");
  const byPath = new Map();
  for (const app of rootApps()) {
    const key = pathKey(app.appspace, app.sections);
    byPath.set(key, [...(byPath.get(key) ?? []), app]);
  }

  for (const app of byPath.get(pathKey(root.name, [])) ?? []) {
    if (matchesSearch(app, state.search)) refs.tree.append(renderApp(app));
  }
  for (const section of root.sections) {
    const rendered = renderSection(
      section,
      root.name === ALL_APPSPACE ? "" : root.name,
      [],
      byPath,
    );
    if (rendered.dataset.hasMatches === "true") refs.tree.append(rendered);
  }
  if (!refs.tree.childElementCount) renderEmpty("Nothing matches that search.");
}

/**
 * Open `app` in the preview, or one of its `children:` pages.
 *
 * A child is just another file in the same folder, served the same way the
 * entry is — same origin, so the background and accent sync still work.
 */
async function openApp(app, updateHash = true, child = null) {
  if (!(await ensureAppspaceGrant(app.appspace))) return;
  if (state.selectedAppspace !== ALL_APPSPACE && app.appspace !== state.selectedAppspace) {
    state.selectedAppspace = app.appspace;
    renderRoot();
  }
  const name = child ? `${app.name} · ${childLabel(child)}` : app.name;
  state.activeApp = app.id;
  state.activeChild = child;
  recordOpening(app);
  resetPreviewBackground();
  applyAppColor(app.color);
  refs.previewFrame.hidden = false;
  refs.previewFrame.src = child ? `/apps/${app.path}/${child}` : app.url;
  refs.previewFrame.title = name;
  refs.previewEmpty.hidden = true;
  document.title = `${name} · ${frontend.title}`;
  if (updateHash) {
    const hash = new URLSearchParams({ app: app.id });
    if (child) hash.set("child", child);
    history.replaceState(null, "", `#${hash}`);
  }
  saveState();
  renderTree();
  if (matchMedia(MOBILE_QUERY).matches) setWidth("collapsed");
}

function showAppspaceLanding() {
  const root = currentAppspace();
  resetPreviewBackground();
  refs.previewFrame.src = "about:blank";
  refs.previewFrame.hidden = true;
  refs.previewFrame.title = "Appspace overview";
  refs.previewEmpty.hidden = false;
  refs.previewAppspace.textContent = root?.name ?? frontend.title;
  document.title = frontend.title;
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

function setWidth(width) {
  state.width = width;
  refs.sidebar.dataset.width = width;
  refs.backdrop.hidden = width === "collapsed" ||
    !matchMedia(MOBILE_QUERY).matches;
  saveState();
}

function cycleWidth() {
  setWidth(nextIn(SIZES, state.width));
}

/**
 * How far each nesting level steps right.
 *
 * Separate from the width on purpose: a narrow sidebar is the case where
 * indentation costs the most, so the two need to be adjustable against
 * each other rather than bundled into one "compact" mode.
 */
function setIndent(indent) {
  const value = INDENTS.includes(indent) ? indent : INDENTS[0];
  state.viewIndents[state.view] = value;
  refs.sidebar.dataset.indent = value;
  saveState();
}

function cycleIndent() {
  setIndent(nextIn(INDENTS, state.viewIndents[state.view] ?? state.indent));
}

function resetPreviewBackground() {
  const root = document.documentElement;
  root.style.removeProperty("--preview-bg");
  root.style.removeProperty("--preview-bg-image");
  root.style.removeProperty("--app-color");
  root.style.removeProperty("--app-tint-image");
  root.style.removeProperty("--app-accent");
  delete document.body.dataset.previewTone;
}

function applyAppColor(color) {
  if (!color || !CSS.supports("color", color)) return;
  const root = document.documentElement;
  root.style.setProperty("--app-color", color);
  root.style.setProperty(
    "--app-tint-image",
    `linear-gradient(color-mix(in srgb, ${color} ${TINT_TOP}%, transparent), ` +
      `color-mix(in srgb, ${color} ${TINT_BOTTOM}%, transparent))`,
  );
  root.style.setProperty(
    "--app-accent",
    `color-mix(in srgb, ${color} ${ACCENT_MIX}%, transparent)`,
  );
}

function syncPreviewBackground() {
  try {
    const doc = refs.previewFrame.contentDocument;
    if (!doc) return;
    const accent = getComputedStyle(doc.documentElement).getPropertyValue("--accent").trim();
    if (accent) applyAppColor(accent);
    for (const element of [doc.body, doc.documentElement]) {
      if (!element) continue;
      const style = getComputedStyle(element);
      const background = style.backgroundColor;
      if (
        !background || background === "rgba(0, 0, 0, 0)" || background === "transparent"
      ) continue;

      const root = document.documentElement;
      root.style.setProperty("--preview-bg", background);
      root.style.setProperty(
        "--preview-bg-image",
        style.backgroundImage && style.backgroundImage !== "none" ? style.backgroundImage : "none",
      );
      document.body.dataset.previewTone = isLightBackground(background, LIGHT_TONE_THRESHOLD)
        ? "light"
        : "dark";
      return;
    }
  } catch {
    // Preview background adaptation is available only to same-origin apps.
  }
}

/**
 * Drop collapsed ids that no longer name anything.
 *
 * Collapsing wrote an id and nothing ever removed one, so a renamed
 * section — or a date node from a day no app carries any more — stayed in
 * storage for good. The whole valid set is derivable from the manifest, so
 * recomputing it is cheaper than tracking removals, and it keeps this
 * bounded once the state lives in a table rather than a string.
 */
function pruneCollapsed() {
  const valid = new Set(
    allSectionIds(manifest.appspaces, ""),
  );
  const walk = (nodes) => {
    for (const node of nodes) {
      valid.add(node.id);
      walk(node.children);
    }
  };
  walk(buildUpdatedTree(apps));
  walk(buildHistoryTree(apps, state.opened));
  state.collapsed = state.collapsed.filter((id) => valid.has(id));
}

function allSectionIds(sections, appspace, parents = []) {
  return sections.flatMap((section) => {
    const path = [...parents, section.name];
    return [pathKey(appspace, path), ...allSectionIds(section.sections, appspace, path)];
  });
}

/* Every hotkey lives here: the handler dispatches off it and the help
   dialog is rendered from it, so a new shortcut is a single line. */
const HOTKEYS = [
  ["/", "Show this help", () => toggleHelp()],
  ["s", "Cycle the sidebar size", () => cycleWidth()],
  ["d", "Cycle indentation in the active view", () => cycleIndent()],
  ["k", "Focus the search box", () => focusSearch()],
  ["x", "Collapse or expand all sections", () => toggleAllSections()],
  ["Esc", "Close help, menus and cards", null],
];

function toggleAllSections() {
  const ids = [...refs.tree.querySelectorAll(".tree-group")]
    .map((group) => group.dataset.sectionId);
  const collapsed = new Set(state.collapsed);
  const shouldCollapse = ids.some((id) => !collapsed.has(id));
  for (const id of ids) {
    if (shouldCollapse) collapsed.add(id);
    else collapsed.delete(id);
  }
  state.collapsed = [...collapsed];
  saveState();
  syncCollapsed();
}

function focusSearch() {
  // Searching a sidebar you cannot see is useless, so open it first.
  if (state.width === "collapsed") setWidth(SIZES[0]);
  refs.search.focus();
  refs.search.select();
}

function toggleHelp() {
  if (refs.help.open) return refs.help.close();
  if (!refs.help.childElementCount) {
    const heading = document.createElement("h2");
    heading.textContent = "Keyboard shortcuts";
    refs.help.append(heading);
    for (const [key, label] of HOTKEYS) {
      const row = document.createElement("div");
      row.className = "help-row";
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      const text = document.createElement("span");
      text.textContent = label;
      row.append(kbd, text);
      refs.help.append(row);
    }
  }
  refs.help.showModal();
}

function bindEvents() {
  const folderNames = document.querySelector("#use-folder-names");
  folderNames.checked = state.useFolderNames;
  folderNames.addEventListener("change", () => {
    state.useFolderNames = folderNames.checked;
    saveState();
    renderTree();
  });
  const more = document.querySelector("#more-menu");
  more.addEventListener("toggle", () => {
    document.querySelector("#more-options").setAttribute(
      "aria-expanded",
      String(more.matches(":popover-open")),
    );
  });
  refs.rootCycle.addEventListener("click", cycleAppspace);
  refs.appspaceLock.addEventListener("click", cycleLockedAppspace);
  refs.rootMenuToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setRootMenu(refs.rootMenu.hidden);
  });
  refs.search.addEventListener("input", () => {
    state.search = refs.search.value;
    saveState();
    renderTree();
  });
  refs.viewButtons.forEach((button) =>
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      if (state.view === "recent") void syncHistory();
      saveState();
      renderTree();
    })
  );
  refs.expandToggle.addEventListener("click", toggleAllSections);
  refs.toggle.addEventListener("click", cycleWidth);
  refs.backdrop.addEventListener("click", () => setWidth("collapsed"));
  refs.previewFrame.addEventListener("load", syncPreviewBackground);
  /* The anchor and the card are two separate hover targets, so both run
     the same pair: enter shows (or keeps) the card, leave hides it unless
     the pointer/focus landed on the other one. */
  const staysOpen = (event) =>
    refs.tooltip.contains(event.relatedTarget) || !!tooltipAnchor?.contains(event.relatedTarget);
  const onTooltipEnter = (event) => {
    const anchor = event.target.closest?.(".app-row__external");
    if (anchor) {
      if (anchor !== tooltipAnchor) showTooltip(anchor);
      else cancelTooltipHide();
    } else if (refs.tooltip.contains(event.target)) {
      cancelTooltipHide();
    }
  };
  const onTooltipLeave = (event) => {
    if (!staysOpen(event)) scheduleTooltipHide();
  };
  for (const target of [refs.tree, refs.tooltip]) {
    target.addEventListener("pointerover", onTooltipEnter);
    target.addEventListener("focusin", onTooltipEnter);
    target.addEventListener("pointerout", onTooltipLeave);
    target.addEventListener("focusout", onTooltipLeave);
  }
  refs.tree.addEventListener("scroll", () => {
    if (tooltipAnchor) positionTooltip(tooltipAnchor);
  }, { passive: true });
  globalThis.addEventListener("resize", () => {
    if (tooltipAnchor) positionTooltip(tooltipAnchor);
  });
  // Covers the back/forward cache too, which "unload" does not.
  globalThis.addEventListener("pagehide", flushState);
  globalThis.addEventListener("message", (event) => {
    if (event.source !== refs.previewFrame.contentWindow) return;
    if (event.data?.type === PREVIEW_BG_MESSAGE) syncPreviewBackground();
  });
  document.addEventListener("click", (event) => {
    if (!refs.rootMenu.hidden && !refs.rootMenu.contains(event.target)) {
      setRootMenu(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setRootMenu(false);
      hideTooltipNow();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      cycleWidth();
      return;
    }
    // Bare letters belong to whatever the user is typing into.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)) return;
    // "?" is the conventional twin of "/" on layouts that need a shift.
    const key = event.key === "?" ? "/" : event.key.toLowerCase();
    const hotkey = HOTKEYS.find(([name, , run]) => run && name === key);
    if (!hotkey) return;
    const [, , run] = hotkey;
    event.preventDefault();
    run();
  });
}

async function init() {
  bindEvents();
  setWidth(state.width);
  setIndent(state.viewIndents[state.view] ?? state.indent);
  refs.search.value = state.search;
  await loadSprite();
  await loadSession();
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`Discovery returned ${response.status}`);
    manifest = await response.json();
    apps = manifest.apps;
    // Old entries have no timestamps. Preserve them without inventing dates.
    for (const id of state.recent) {
      const app = appById(id);
      if (app && !Object.hasOwn(state.opened, app.id)) {
        state.opened[app.id] = 0;
        state.pendingHistory[app.id] = 0;
      }
    }
    state.recent = [];
    pruneCollapsed();
    void syncHistory();
    setInterval(() => {
      if (!document.hidden) {
        refreshHistory();
        if (state.view === "recent" || Object.keys(state.pendingHistory).length) void syncHistory();
      }
    }, HISTORY_REFRESH);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshHistory();
        void syncHistory();
      }
    });
    window.addEventListener("online", () => void syncHistory());

    if (
      !appspaceOptions().some((item) => item.name === state.selectedAppspace) ||
      !isUnlocked(state.selectedAppspace)
    ) {
      state.selectedAppspace = firstUnlockedAppspace()?.name ?? null;
    }
    renderRoot();
    renderTree();

    const wanted = new URLSearchParams(location.search).get("auth");
    if (wanted && appspaceByName(wanted)) {
      const unlocked = await ensureAppspaceGrant(wanted);
      stripAuthQuery();
      if (unlocked) {
        state.selectedAppspace = wanted;
        renderRoot();
        renderTree();
      }
    } else {
      stripAuthQuery();
    }

    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const active = appById(hash.get("app"));
    if (active && await ensureAppspaceGrant(active.appspace)) {
      const child = hash.get("child");
      if (state.selectedAppspace !== ALL_APPSPACE) state.selectedAppspace = active.appspace;
      renderRoot();
      await openApp(active, false, active.children?.includes(child) ? child : null);
    } else {
      state.activeApp = null;
      state.activeChild = null;
      showAppspaceLanding();
    }
    saveState();
  } catch (error) {
    refs.rootName.textContent = "Failed to load apps";
    refs.rootDescription.textContent = error?.message || "Unknown error";
    renderEmpty("The app list could not be loaded.");
  }
}

init();
