# Inventory data

`inventory.yaml` is the manifest: `schema_version: 1`, the original `captured_on`
date, and the filenames for formulae, dependencies, casks, mas, setapp, dmgs,
and scripts. Each source file has `schema_version: 1` and its named list.

Edit the matching source file to add or update a package. Dependencies are kept
separate from directly installed formulae and appear only in Inventory.
The original `dependency` flags are retained for reference; the source file
determines the displayed type.

This app reads a small YAML subset: each item begins with `  - name:`, fields
use four spaces, and scalar values are JSON literals (double-quoted strings,
numbers, or booleans). Keep package names first. The loader rejects unsupported
schema versions instead of silently loading them.

Optional fields: `version`, `description`, `url`, `brew_url`, `updated`,
`installs_365d`, `group`, `command`, `download`, `icon`, and `id` (the Mac App Store ID).
An explicit `command` overrides the generated installation command, including
in batch copying. Commands are copied only, never executed by this page.

Cask `icon` values use PNG artwork from CaskHub's CaskFlow `icons` branch via
jsDelivr. The filename matches the Homebrew cask token. Entries without known
artwork use the interface's built-in fallback symbol.

`captured_on` describes the original snapshot; `updated` is per-package metadata.
Updating a package does not imply the entire inventory was rescanned.

Optional `priority` controls install-view ordering. Positive integers appear first in
“First picks” (1 before 2). Negative integers appear last in “Last picks” (-1 before
-2). Entries without a priority stay in “Everything else”, preserving their source
order. Both views group this way after applying search and category filters. Omit the
field for normal placement.
