#!/usr/bin/env bash
# Adds "HTML Editor" to your application menu when running from source
# (i.e. after `npm install`). For a proper package use `npm run dist` instead.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON="$APP_DIR/node_modules/.bin/electron"
if [ ! -x "$ELECTRON" ]; then
  echo "Electron is not installed yet. Run 'npm install' in $APP_DIR first." >&2
  exit 1
fi

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"
mkdir -p "$APPS_DIR" "$ICON_DIR"
cp "$APP_DIR/build/icon.png" "$ICON_DIR/htmleditor.png"

cat > "$APPS_DIR/htmleditor.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=HTML Editor
Comment=Edit HTML pages visually, without writing code
Exec="$ELECTRON" "$APP_DIR" %f
Icon=htmleditor
Terminal=false
Categories=Development;WebDevelopment;Utility;
MimeType=text/html;
Keywords=html;web;editor;wysiwyg;design;
StartupWMClass=htmleditor
DESKTOP

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" || true
echo "Installed launcher: $APPS_DIR/htmleditor.desktop"
echo "You can now find 'HTML Editor' in your application menu."
