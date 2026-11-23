#!/usr/bin/env bash
# Builds the signed Android App Bundle (.aab) to upload to Google Play.
#
#   android/scripts/build-play-bundle.sh create-key   # once: create the private upload key
#   android/scripts/build-play-bundle.sh 1.0.0        # build HomeBlockbuster-1.0.0.aab
#
# The upload key lives outside the repository (default ~/.homeblockbuster/upload-key.jks, override with
# HB_UPLOAD_KEYSTORE). Back it up together with its password: every future Play update must be signed
# with it (if it is lost, Play support can reset it, but that takes days).
# Passwords are read from the terminal and never written to disk.
set -euo pipefail

cd "$(dirname "$0")/.."

KEYSTORE="${HB_UPLOAD_KEYSTORE:-$HOME/.homeblockbuster/upload-key.jks}"
ALIAS="${HB_UPLOAD_KEY_ALIAS:-upload}"

# Homebrew JDK and Android SDK, unless the environment already points somewhere.
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17 ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi
[ -n "${JAVA_HOME:-}" ] && export PATH="$JAVA_HOME/bin:$PATH"
if [ -z "${ANDROID_HOME:-}" ]; then
  for d in "$HOME/Library/Android/sdk" /opt/homebrew/share/android-commandlinetools; do
    [ -d "$d" ] && export ANDROID_HOME="$d" && break
  done
fi

if [ "${1:-}" = "create-key" ]; then
  if [ -e "$KEYSTORE" ]; then
    echo "An upload key already exists at $KEYSTORE; not overwriting it." >&2
    exit 1
  fi
  mkdir -p "$(dirname "$KEYSTORE")"
  chmod 700 "$(dirname "$KEYSTORE")"
  echo "Creating the upload key at $KEYSTORE (alias '$ALIAS')."
  echo "keytool asks for a password (at least 6 characters) and your name; keep the password safe."
  keytool -genkeypair -v -storetype PKCS12 -keystore "$KEYSTORE" -alias "$ALIAS" \
    -keyalg RSA -keysize 4096 -validity 10000
  chmod 600 "$KEYSTORE"
  echo
  echo "Done. Back up $KEYSTORE and its password (e.g. in your password manager)."
  exit 0
fi

VERSION="${1:-}"
if ! [[ "$VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "Usage: $0 create-key | <version, e.g. 1.0.0>" >&2
  exit 1
fi
# Same scheme as the GitHub workflow: 1.2.3 -> 10203. Play rejects a versionCode it has seen before.
CODE=$(( BASH_REMATCH[1] * 10000 + BASH_REMATCH[2] * 100 + BASH_REMATCH[3] ))

if [ ! -f "$KEYSTORE" ]; then
  echo "No upload key at $KEYSTORE. Run: $0 create-key" >&2
  exit 1
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  echo "Android SDK not found. Install it (brew install --cask android-commandlinetools) or set ANDROID_HOME." >&2
  exit 1
fi
echo "sdk.dir=$ANDROID_HOME" > local.properties

read -r -s -p "Upload key password: " PASSWORD
echo

export HB_KEYSTORE_FILE="$KEYSTORE"
export HB_KEYSTORE_PASSWORD="$PASSWORD"
export HB_KEY_ALIAS="$ALIAS"
export HB_KEY_PASSWORD="$PASSWORD"
export HB_VERSION_NAME="$VERSION"
export HB_VERSION_CODE="$CODE"

./gradlew --no-daemon :app:testDebugUnitTest :app:bundleRelease

mkdir -p dist
OUT="dist/HomeBlockbuster-$VERSION.aab"
cp app/build/outputs/bundle/release/app-release.aab "$OUT"
echo
echo "Built android/$OUT (versionName $VERSION, versionCode $CODE)."
echo "Upload it in Play Console → Test and release → Testing → Internal testing → Create new release."
