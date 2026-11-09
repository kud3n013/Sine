#!/usr/bin/env bash

# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Downloads a browser with browsercfg, installs Sine into it, opens the
# settings page headlessly and checks that the Sine Mods pane was injected.
#
# Usage: scripts/smoke_test.sh <browser-channel> [result.json]
#   e.g. scripts/smoke_test.sh zen-twilight
#
# Exits 0 when every check passes, 1 otherwise. The JSON result is written to
# the second argument (default: smoke-result.json).

set -euo pipefail

browser="${1:?usage: scripts/smoke_test.sh <browser-channel> [result.json]}"
result="$(realpath -m "${2:-smoke-result.json}")"
dir=".browsercfg/browsers/${browser/-/_}"

cd "$(dirname "$0")/.."

select_args=(--browser "$browser" --download)
# Without a TTY browsercfg cannot ask whether to remove the previously selected
# browser and panics, so answer yes up front.
if [[ ! -t 0 ]]; then
  select_args+=(--uninstall)
fi
bunx browsercfg select "${select_args[@]}"

# browsercfg reports success even when the download failed, so check for the binary.
bin=""
for candidate in zen-bin firefox-bin floorp-bin; do
  if [[ -x "$dir/browser/$candidate" ]]; then
    bin="$dir/browser/$candidate"
    break
  fi
done
if [[ -z "$bin" ]]; then
  echo "error: no browser binary found in $dir/browser (download failed?)" >&2
  exit 1
fi

bunx browsercfg import

# Hook the smoke test into the browser's autoconfig script.
cat tests/smoke/settings.smoke.js >> "$dir/browser/config.js"

# Let the smoke test's dump() progress messages reach stdout.
echo 'user_pref("browser.dom.window.dump.enabled", true);' >> "$dir/profile/user.js"

# A previous run that was killed leaves a lock that stops the browser from starting.
rm -f "$dir/profile/lock" "$dir/profile/.parentlock" "$result"

echo "Running $bin..."
SINE_SMOKE_RESULT="$result" MOZ_DISABLE_CONTENT_SANDBOX=1 \
  timeout 240 "$bin" -profile "$PWD/$dir/profile" --headless || true

if [[ ! -f "$result" ]]; then
  echo "error: the browser exited without writing a result" >&2
  exit 1
fi

cat "$result"
echo
grep -q '"passed": true' "$result"
