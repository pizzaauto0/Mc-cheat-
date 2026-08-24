#!/usr/bin/env bash
# Run on Linux, inside this folder, after: pip install -r requirements.txt
# Needs GTK3 + WebKit2GTK installed system-wide, e.g. on Debian/Ubuntu:
#   sudo apt-get install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
set -e
pyinstaller --onefile --noconsole --name GTA6DevLauncher --add-data "index.html:." launcher.py
echo
echo "Done. Find the binary in dist/GTA6DevLauncher"
