#!/usr/bin/env bash
# Regenerates the Google Play phone screenshots in android/play-store/screenshots/.
#
# 1. demo_art.py draws the artwork for an invented demo library (no real films, posters or logos).
# 2. The PlayStoreScreenshots Robolectric test renders the real app UI (MainActivity, Compose, networking,
#    image loading) against an in-process demo server and captures each screen with Roborazzi at
#    1080x1920 (portrait) or 1920x1080 (landscape player).
# 3. finish_screenshots.py adds a phone status bar and checks the sizes Google Play requires.
#
# Needs: JDK 21 (Robolectric's Android 15 runtime requires it), the Android SDK (platform 36),
# python3 with Pillow + numpy, and npm (to fetch the Bebas Neue font once).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
android="$(dirname "$here")"
work="$android/app/build/play-store"
rm -rf "$work/raw"
mkdir -p "$work/raw"

python3 "$here/demo_art.py" "$work/art"

(
  cd "$android"
  # Set ROBOLECTRIC_REPO_URL to a Maven Central mirror if Robolectric's runtime download is rate-limited.
  HB_SCREENSHOT_ART="$work/art" HB_SCREENSHOT_OUT="$work/raw" \
    ./gradlew :app:testDebugUnitTest --tests '*PlayStoreScreenshots*' --console=plain
)

python3 "$here/finish_screenshots.py" "$work/raw" "$here/screenshots"
