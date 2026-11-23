# Google Play screenshots

`screenshots/` holds the phone screenshots for the store listing (PNG, 1080×1920 portrait).

They show the real app: `MainActivity` with its Compose UI, networking and image loading, rendered by
Robolectric and captured with Roborazzi. The app talks to an in-process demo server
(`app/src/test/.../screenshots/DemoServer.kt`) that serves an invented library (`DemoLibrary.kt`).
Every title, person, poster and backdrop is fictional and drawn by `demo_art.py`, so no copyrighted
material appears.

To regenerate them:

```bash
android/play-store/make-screenshots.sh
```

This needs JDK 21 (Robolectric's Android 15 runtime requires it), the Android SDK with platform 36,
python3 with Pillow and numpy, and npm (to fetch the Bebas Neue font once). If Maven Central rate-limits
Robolectric's runtime download, set `ROBOLECTRIC_REPO_URL` to a mirror, for example
`https://maven-central.storage-download.googleapis.com/maven2`.

The screenshot test (`app/src/test/screenshots/`) and its test-only dependencies (Robolectric, Roborazzi,
MockWebServer) are only added to the build when `HB_SCREENSHOT_ART` is set, which the script does. Normal
`testDebugUnitTest` runs, CI and the release build resolve exactly what they did before.

The script also writes `06-player.png` (1920×1080) and `07-profiles.png`. They are not committed yet:
on those screens some text is black on the dark background (see the pull request), so add them once
that is fixed.
