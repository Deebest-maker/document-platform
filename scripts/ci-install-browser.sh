#!/usr/bin/env bash
# Install one Playwright browser and its system libraries on a CI runner, and
# survive trouble with the package mirrors.
#
# On 22 October 2026 browser installs failed repeatedly with no code at fault:
# apt hung for hours on one font package from the Azure Ubuntu mirror, apt would
# not update at all when the Microsoft repository answered 403, and the main
# Ubuntu archive stalled while a mirror was down. So:
#   * only Ubuntu's own package sources are used (the browser's libraries come
#     from there);
#   * each attempt has a time limit;
#   * attempts alternate between the runner's default mirror and the main Ubuntu
#     archive;
#   * a failed attempt prints its last output as a warning on the check run (job
#     logs cannot be read from outside GitHub) and stops any package-manager
#     process it left behind.
#
# Usage: scripts/ci-install-browser.sh chromium|firefox|webkit
# Test hooks: INSTALL_LIMITS ("180 240 240" seconds per attempt) and
# INSTALL_COMMAND (the command to run, default the Playwright install).

set -u

browser="${1:?usage: ci-install-browser.sh chromium|firefox|webkit}"
log="${RUNNER_TEMP:-/tmp}/browser-install.log"
read -r -a limits <<<"${INSTALL_LIMITS:-180 240 240}"
sources_dir="${APT_SOURCES_DIR:-/etc/apt/sources.list.d}"
ubuntu_sources="${sources_dir}/ubuntu.sources"
original_sources="${RUNNER_TEMP:-/tmp}/ubuntu.sources.original"

as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

install_command() {
  if [ -n "${INSTALL_COMMAND:-}" ]; then
    bash -c "$INSTALL_COMMAND"
  else
    pnpm --filter @document-platform/web exec playwright install --with-deps "$browser"
  fi
}

annotate() { # level title file lines
  tail -n "$4" "$3" 2>/dev/null | while IFS= read -r line; do
    echo "::$1 title=$2::${line}"
  done
}

as_root find "$sources_dir" -maxdepth 1 -type f ! -name 'ubuntu.sources' -delete 2>/dev/null || true
[ -f "$ubuntu_sources" ] && cp "$ubuntu_sources" "$original_sources"

use_default_mirror() {
  [ -f "$original_sources" ] && as_root cp "$original_sources" "$ubuntu_sources"
}

use_main_archive() {
  [ -f "$ubuntu_sources" ] || return 0
  as_root sed -i -E \
    's#mirror\+file:/etc/apt/apt-mirrors\.txt#http://archive.ubuntu.com/ubuntu/#g; s#https?://azure\.archive\.ubuntu\.com/ubuntu/?#http://archive.ubuntu.com/ubuntu/#g' \
    "$ubuntu_sources"
}

stop_leftovers() {
  for name in apt apt-get dpkg; do as_root pkill -9 -x "$name" 2>/dev/null || true; done
  as_root rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock \
    /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend 2>/dev/null || true
  as_root dpkg --configure -a 2>/dev/null || true
}

attempt=0
for limit in "${limits[@]}"; do
  attempt=$((attempt + 1))
  if [ $((attempt % 2)) -eq 0 ]; then
    use_main_archive
    source_name="the main Ubuntu archive"
  else
    use_default_mirror
    source_name="the runner's default mirror"
  fi
  echo "Browser install, attempt ${attempt} of ${#limits[@]} from ${source_name}, limit ${limit}s"
  : >"$log"
  export -f install_command
  export browser INSTALL_COMMAND
  timeout --kill-after=10 "$limit" bash -c 'set -o pipefail; install_command 2>&1 | tee -a "$0"' "$log"
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "Browser install finished on attempt ${attempt}"
    exit 0
  fi
  annotate warning "Browser install attempt ${attempt} failed (exit ${status}) - last output" "$log" 6
  stop_leftovers
done

annotate error "Browser install failed every attempt - last output" "$log" 8
exit 1
