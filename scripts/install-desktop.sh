#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bin_dir="$HOME/.local/bin"
app_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
# Desktop Exec fields need escaping beyond shell quoting. Reject unusual paths.
if [[ "$project_dir" == *'"'* || "$project_dir" == *'%'* || "$project_dir" == *'`'* || "$project_dir" == *'$'* || "$project_dir" == *'\'* || "$project_dir" == *$'\n'* ]]; then
  echo 'Der Projektpfad enthält nicht unterstützte Sonderzeichen.' >&2
  exit 1
fi
for name in unterwegs unterwegs-mcp; do
  target="$bin_dir/$name"
  if [[ -e "$target" || -L "$target" ]] && [[ "$(readlink -f -- "$target")" != "$project_dir/bin/$name" ]]; then
    echo "Vorhandene Datei bleibt unverändert: $target" >&2
    exit 1
  fi
done
if [[ -e "$app_dir/unterwegs.desktop" ]] && ! grep -Fq "X-Unterwegs-Project=$project_dir" "$app_dir/unterwegs.desktop"; then
  echo 'Ein anderer Unterwegs-Menüeintrag existiert bereits.' >&2
  exit 1
fi
mkdir -p "$bin_dir" "$app_dir"
for name in unterwegs unterwegs-mcp; do
  ln -sfn -- "$project_dir/bin/$name" "$bin_dir/$name"
done
cat > "$app_dir/unterwegs.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Unterwegs
Comment=Lokaler Paket-Tracker
Exec="$project_dir/bin/unterwegs"
Icon=$project_dir/desktop/assets/icon.png
Terminal=false
Categories=Utility;
X-Unterwegs-Project=$project_dir
DESKTOP
printf '%s\n' 'Menüeintrag und CLI-Verknüpfungen eingerichtet.' 'Für den CLI-Aufruf muss ~/.local/bin im PATH stehen.'
