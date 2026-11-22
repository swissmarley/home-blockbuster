# Home Blockbuster

A self-hosted, Netflix-style streaming experience for the movies and TV shows you already own — on a **NAS**, a **server**, an **external drive** or your computer's **internal drive**.

Point it at your folders. It finds your videos, reads the tags and cover art embedded in the files (MP4/iTunes atoms, Matroska tags, ID3), fetches posters, backdrops, title logos, cast, genres and episode details from **free metadata APIs**, and presents everything in an interface that looks and feels like Netflix — billboard previews, hover cards, Top 10 rows, "Continue Watching", profiles and a full-featured player.

![Home screen](docs/screenshots/home.jpg)

| Hover card | Title details & episodes |
| --- | --- |
| ![Hover card](docs/screenshots/hover-card.jpg) | ![Episodes](docs/screenshots/episodes.jpg) |
| **Player with subtitles** | **Who's watching?** |
| ![Player](docs/screenshots/player.jpg) | ![Profiles](docs/screenshots/profiles.jpg) |

<sub>Screenshots show the synthetic demo library from `scripts/generate-demo-media.mjs`.</sub>

## Features

**Your media, wherever it lives**
- Libraries for movies, TV shows or mixed folders on local disks, external/USB drives, mounted NAS shares (SMB/CIFS, NFS), Windows UNC paths (`\\NAS\Movies`) and Docker volumes.
- A built-in folder browser that shows drives, `/Volumes`, `/mnt`, `/media`, home folders and custom roots, with a reachability check before you save.
- Understands Plex/Jellyfin naming, scene releases, anime, daily shows, multi-episode files, editions, parts and IMDb/TMDB ids in names. Skips samples, extras and NAS system folders (`@eaDir`, `#recycle`…).
- **Movie series**: videos that belong together — parts, editions, numbered clips or names that start the same — are shown as one title with an episode list, and play one after another.
- Incremental rescans (only new or changed files are read) and automatic scheduled scans.
- **Offline-safe**: if a drive or share is disconnected, its titles are kept and the library is marked offline instead of being wiped.
- Read-only: your files are never moved, renamed or modified.

**Metadata, artwork & tags**
- Embedded metadata is read first: title, year, genre, description, show/season/episode atoms and **cover art** (MP4 `covr`, Matroska attachments, ID3 pictures).
- Online metadata from free services: **TMDB** (free API key — best results: textless backdrops, logos, cast, keywords, episode stills), **TVmaze** and the **iTunes Search API** (no key needed), **OMDb** (free key).
- Fuzzy matching with year checks, automatic merging of duplicates, and a **Fix match** dialog to pick the right entry by hand.
- Frames grabbed from the video itself when a title or episode has no artwork.

**The Netflix experience**
- Profile gate ("Who's watching?"), up to 5 profiles with avatars, **Kids profiles** (only G/PG/TV-G… titles), per-profile My List, thumbs ratings, history and autoplay settings.
- Billboard with muted **autoplay preview** from your own file, rows with page sliders, **hover mini-modals** that grow out of the card, Top 10 rows with big rank numbers, "Because you watched…", genre rows, New & Popular, search across titles, people and genres, notifications for new arrivals.
- Detail modal with season picker, episode list with progress, More Like This and About sections.
- Player with Netflix-style controls: scrubber with **frame previews**, ±10 s, volume, audio track and subtitle selection, playback speed, episodes panel, **next-episode countdown**, "You're watching" pause screen and keyboard shortcuts.

**Playback that just works**
- Direct play with HTTP range requests for browser-friendly files.
- On-the-fly **remux** (e.g. MKV → MP4, AC3 → AAC) or **transcode** (HEVC, 10-bit, DivX/Xvid…) with ffmpeg, chosen per browser. Browsers without H.264/AAC get VP9/Opus.
- Optional hardware encoding: NVIDIA NVENC, Intel Quick Sync, VAAPI, Apple VideoToolbox.
- Sidecar subtitles (`.srt`, `.vtt`, `.ass`/`.ssa`, any encoding, language/forced/SDH detection) and embedded text subtitles.
- Resume where you left off, on any device.

## Quick start

### Requirements

- **Node.js 20.19+** (22 LTS recommended)
- **ffmpeg** (recommended): enables transcoding, thumbnails and scrubbing previews. Without it, only browser-friendly files (MP4/WebM with H.264, VP9 or AV1) play.
  - Windows: `winget install Gyan.FFmpeg` · macOS: `brew install ffmpeg` · Debian/Ubuntu: `sudo apt install ffmpeg`

### Install and run

```bash
git clone https://github.com/swissmarley/home-blockbuster.git
cd home-blockbuster
npm ci
npm run build
npm start
```

Open **http://localhost:8585** (or `http://<your-computer's-ip>:8585` from a TV, tablet or phone on the same network). The first-run setup walks you through creating your profile and adding your first library.

No media at hand? Generate a small demo library (requires ffmpeg):

```bash
node scripts/generate-demo-media.mjs --out ./test-media
```

### Docker

There are two ways to run it with Docker. Pick one.

#### Plain HTTP from the source folder (unchanged)

```bash
docker compose up -d
```

Edit `docker-compose.yml` first: every folder you want to watch must be mounted into the container (for example `/path/to/Movies:/media/movies:ro`). Inside the app, add libraries using the container paths (`/media/movies`). The image includes ffmpeg; data is stored in `./data`. Open `http://<your-computer's-ip>:8585`.

This file works exactly as it always did, so `git pull` followed by `docker compose up -d --build` on a server that already runs this way changes nothing: still HTTP on port 8585, your edits and your `./data` untouched.

The server runs as the unprivileged `node` user (uid 1000), so your media must be readable by that user. On start, the container takes ownership of the data folder, which matters when you upgrade from an older image that ran as root. For VAAPI, also add the host's `render` group with `group_add` (see the compose file).

#### One-command install with the published image

On any machine with [Docker](https://docs.docker.com/get-docker/) (Linux, macOS, a NAS, a Raspberry Pi):

```bash
curl -fsSL https://github.com/swissmarley/home-blockbuster/releases/latest/download/install.sh | sh
```

It asks how your devices should connect, then pulls the published image (`ghcr.io/swissmarley/home-blockbuster`, amd64 and arm64) and starts it. Re-run the same command to update; your `.env` and `./data` are kept. Everything can be preset with environment variables to run unattended (see the header of [`install.sh`](install.sh)), and `HB_VERSION=1.1.0` pins a release.

| Mode | Address | Encryption | Best for |
| --- | --- | --- | --- |
| **Tailscale** (recommended) | `https://home-blockbuster.<your-tailnet>.ts.net` | HTTPS with a real certificate | iPhone and any device, at home and away; nothing to install on the devices except the Tailscale app |
| **HTTP** | `http://<this-machine>:8585` | none | A trusted home network, the simplest setup |
| **Caddy** | `https://<your domain, name or IP>` | HTTPS: Let's Encrypt, a private CA or your own certificate | Your own domain, or no Tailscale |

**Tailscale.** You need a free [Tailscale](https://tailscale.com/) account and the Tailscale app on the devices that watch. Once, in the [admin console](https://login.tailscale.com/admin/dns), turn on **MagicDNS** and **HTTPS Certificates**. The installer starts a Tailscale container next to the app and prints a login link; open it and approve the device. The app is then reachable only from your own Tailscale network (it is not published on the internet), over a certificate every device already trusts. In the iOS or Android app, add the server with the full `https://…ts.net` address.

**HTTP.** `HB_MODE=http` (or choose it in the installer) publishes the app on port 8585 like the source setup. Anyone on your network can read the traffic, so set a password if the network is shared.

**Caddy.** A [Caddy](https://caddyserver.com/) container terminates TLS on ports 80 and 443 and the app is not published on the network; port 80 only redirects to HTTPS. Which certificate you get depends on the name you chose:

| You open the app with | Certificate | One-time step |
| --- | --- | --- |
| A public domain (`media.example.com`) pointing at this machine, ports 80/443 forwarded | Free **Let's Encrypt**, renewed automatically | None |
| A LAN name or IP (`nas.local`, `192.168.1.20`, `localhost`) | Caddy's **private local CA** | Install `home-blockbuster-root-ca.crt` (exported by the installer) on each device and trust it. The installer prints the steps for iOS, macOS, Windows, Android and Linux |
| Your own certificate | Files in `./certs` | Set `HB_TLS="/certs/fullchain.pem /certs/privkey.pem"` in `.env` |

Public domains automatically get a generated password if you do not set one.

To manage the install later, work from its folder (`~/home-blockbuster` by default):

```bash
docker compose logs -f      # watch the logs
docker compose down         # stop
nano .env                   # change folders, password… then: docker compose up -d
```

Every folder you want to watch must be mounted into the container: `HB_MOVIES_DIR` and `HB_TV_DIR` in `.env` cover the usual case, and the compose file has commented examples for USB drives, SMB/NFS shares and GPU transcoding. Inside the app, add libraries using the container paths (`/media/movies`, `/media/tv`). All `.env` options are listed in [`.env.docker.example`](.env.docker.example). To run this package from a source checkout instead of the installer: copy `.env.docker.example` to `.env`, then `docker compose -f docker-compose.deploy.yml up -d --build`.

Enter keys in **Settings → Metadata & Artwork**, or set `TMDB_API_KEY` / `OMDB_API_KEY`. Without any key, TVmaze and iTunes still provide artwork and details, and tags embedded in your files are used as a fallback. Artwork is cached locally after the first view.

**Publishing (maintainers):** pushing a `v*.*.*` tag runs `.github/workflows/publish.yml`, which tests the code, pushes the multi-arch image to GitHub Container Registry (tags `1.2.3`, `1.2`, `latest`; every push to `main` updates `edge`) and attaches `install.sh`, `docker-compose.deploy.yml`, `Caddyfile` and `tailscale-serve.json` to a GitHub Release. The package must be public (repository **Packages** settings) so anyone can pull it.

#### Moving an existing server to HTTPS

A server running from the source folder (HTTP on 8585) keeps working after `git pull`; move it to the installer setup only when you want HTTPS.

1. In the old folder: `docker compose down`.
2. Keep your data: `mkdir -p ~/home-blockbuster && cp -a ./data ~/home-blockbuster/data`.
3. Run the installer, choose **Tailscale** (or Caddy), and give it the same movie and TV folders.
4. Libraries are stored with their container paths. The installer mounts the folders at `/media/movies` and `/media/tv`; if your old setup used other paths (a USB drive, a NAS share), add matching volumes to `~/home-blockbuster/docker-compose.yml`.
5. In the iOS or Android app, add the new `https://…` address (the old `http://<ip>:8585` entry no longer exists once the old container is stopped). No new app build is needed, and the apps still accept plain HTTP servers too.

Installs made with release 1.0.0 (Caddy only) upgrade in place: re-run the installer and it keeps your settings.

## Mobile apps

Native apps for iPhone/iPad (`ios/`) and Android (`android/`) connect to any Home Blockbuster server: save as many servers as you like, pick a profile and browse the same rows, search, My List and title pages as the web app, with muted previews, Continue Watching and a full-screen player (audio tracks, subtitles, speed, episodes panel, next-episode countdown). Progress, My List and ratings are shared with every other device.

### Android

1. On your phone, open the [latest Android release](https://github.com/swissmarley/home-blockbuster/releases?q=android&expanded=true) and download `HomeBlockbuster-<version>.apk`.
2. Open the downloaded file. The first time, Android asks you to allow installing apps from your browser or file manager; allow it, go back and tap **Install**. Later versions install over the previous one and keep your servers.
3. Tap **Add Server** and enter the address you use in a browser, for example `192.168.1.20:8585` (8585 is added if you leave out the port), `nas.local:8585` or `https://box.tailnet.ts.net`.

Requires Android 8.0 or newer. MP4, MKV and WebM files whose codecs the phone decodes (H.264, and HEVC/VP9/AV1/AC3 where the hardware supports them) play directly; everything else is converted by the server, as for the iPhone. Going home while a video plays keeps it in a picture-in-picture window.

For HTTPS with Caddy's private local CA, install `home-blockbuster-root-ca.crt` on the phone first (**Settings → Security → Encryption & credentials → Install a certificate → CA certificate**; the exact path varies by manufacturer). The app trusts user-installed certificates for this purpose. Plain HTTP servers on your network work without any setup.

**Building it yourself:** install JDK 17+ and the Android SDK (or Android Studio), then `cd android && ./gradlew assembleRelease`; the APK is in `android/app/build/outputs/apk/release/`. `./gradlew testDebugUnitTest` runs the unit tests; with `HB_TEST_SERVER=http://localhost:8585` set it also drives the API client against a running server.

**Releases:** the [Android workflow](.github/workflows/android.yml) builds and tests every change under `android/`. Pushing a tag such as `android-v1.2.3` (or running the workflow by hand with *release* checked) publishes a GitHub Release with the signed APK. By default the APK is signed with the public community key in `android/keystore/`, so anyone's build of the open-source app updates cleanly; to sign with your own private key instead, add the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` (switching keys means uninstalling the old app once).

## Adding your media

Home Blockbuster reads folders **as the server sees them**. Anything the operating system can mount can be a library.

| Where your videos are | What to enter |
| --- | --- |
| Internal drive | `D:\Movies`, `/Users/me/Movies`, `/home/me/Videos` |
| External / USB drive | Windows: its drive letter (`E:\Films`) · macOS: `/Volumes/MyDrive/Films` · Linux: `/media/<user>/MyDrive/Films` |
| NAS on Windows | A UNC path such as `\\NAS\Movies`, or a mapped drive letter (`Z:\`) |
| NAS on macOS | Connect in Finder (⌘K → `smb://nas.local/Movies`), then use `/Volumes/Movies` |
| NAS on Linux | Mount it, e.g. `sudo mount -t cifs //nas/Movies /mnt/nas/movies -o ro,guest,uid=$(id -u)` or add it to `/etc/fstab`; NFS: `sudo mount -t nfs nas:/volume1/Movies /mnt/nas/movies`. Then use `/mnt/nas/movies` |
| NAS with Docker | Use the CIFS/NFS volume examples in `docker-compose.yml`, or mount on the host and bind-mount the folder |
| Running directly on the NAS | Synology `/volume1/video`, QNAP `/share/Multimedia`, Unraid `/mnt/user/media`… |

`smb://` URLs can't be read directly — mount the share first (this is also how Plex and Jellyfin work).

### Naming tips

Most names work as they are, but these patterns give the most reliable matches:

```
Movies/Inception (2010)/Inception (2010).mkv
Movies/The Matrix (1999) {imdb-tt0133093}.mp4
TV Shows/Breaking Bad (2008)/Season 01/Breaking Bad - S01E01 - Pilot.mkv
TV Shows/The Daily Show/The Daily Show 2024-03-14.mp4
Subtitles next to the video: Inception (2010).en.srt, Inception (2010).de.forced.srt
```

Choose the library type (**Movies**, **TV Shows** or **Mixed**) when adding a folder — it helps with ambiguous names. If something is matched wrongly, open the title and use **Fix match**.

#### Movie series (home videos, multi-part films)

Videos in the **same folder** (and with the same year, or none) that belong together become one title, listed like the episodes of a series. When one ends, the next one starts automatically.

```
Family/We gonna walk with Johnny.mp4      ┐ "We gonna walk": names that start with the
Family/We gonna walk with Mary.mp4        ┘ same words (at least two meaningful ones)
Family/Vacation 1.mp4, Vacation 2.mp4       "Vacation": numbered from 1 (also "Vacation - 1")
Family/Vacation - Beach.mp4, Vacation - Mountains.mp4
Family/Wedding Part 1.mp4, Wedding E02.mp4, Wedding #3.mp4, Wedding 1 of 3.mp4, Wedding_04.mp4
Family/Christmas 2019/IMG_0001.MOV …       camera clips take the folder's name
Movies/Some Movie (2010) - Extended.mkv     editions and parts of a movie
```

Sequels keep their own titles: numbers that don't start at 1 (`Toy Story 2`, `Ocean's 12`), roman numerals (`Rocky II`), different years, and names that only share filler words (`The Man Who…`) are not grouped. Copies of the same video (another resolution or drive) stay versions of one entry.

## Metadata providers

| Provider | Key | Used for |
| --- | --- | --- |
| [TMDB](https://www.themoviedb.org/settings/api) | Free API key (v3 key or v4 read-access token) | Movies & shows: textless backdrops, title logos, posters, cast, crew, keywords, maturity ratings, episode names and stills |
| [TVmaze](https://www.tvmaze.com/api) | None | TV shows, seasons, episodes, images |
| [iTunes Search API](https://performance-partners.apple.com/search-api) | None | Movie and TV posters, descriptions, ratings |
| [OMDb](https://www.omdbapi.com/apikey.aspx) | Free key (1,000 requests/day) | Posters, plots, IMDb ratings |

Enter keys in **Settings → Metadata & Artwork**, or set `TMDB_API_KEY` / `OMDB_API_KEY`. Without any key, TVmaze and iTunes still provide artwork and details, and tags embedded in your files are used as a fallback. Artwork is cached locally after the first view.

## Configuration

All settings are optional environment variables (see `.env.example`):

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8585` | HTTP port |
| `HOST` | `0.0.0.0` | Interface to listen on (`127.0.0.1` for this machine only) |
| `DATA_DIR` | `./data` | Database, artwork cache, thumbnails |
| `HB_PASSWORD` | – | Require a password to use the app (overrides one set in **Settings → Security**) |
| `TRUST_PROXY` | – | Behind a reverse proxy: trust its `X-Forwarded-*` headers (`1` = one hop, or `loopback`, a subnet…). Needed for per-client sign-in rate limits and `Secure` cookies over HTTPS |
| `ALLOWED_HOSTS` | – | Without a password, other host names to answer to, comma separated (`media.example.com`, `.example.com`). IPs, `localhost` and LAN names always work |
| `ALLOW_EXTERNAL_SYMLINKS` | off | Follow symlinks in a library that point outside every library folder |
| `TMDB_API_KEY`, `OMDB_API_KEY` | – | Metadata API keys (also settable in the UI) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | auto-detected | Location of ffmpeg / ffprobe |
| `MEDIA_ROOTS` | – | Extra shortcuts in the folder browser, comma separated (e.g. Docker mounts) |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | Render node for VAAPI transcoding |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `IMAGE_CACHE_MAX_MB` | `2048` | Size cap for downloaded artwork |
| `TMDB_API_BASE`, `TMDB_IMAGE_BASE`, `IMAGE_PROXY_EXTRA_HOSTS` | – | Advanced: use a TMDB mirror/proxy, or a local stand-in for testing |

Playback, transcoding, hardware acceleration, thumbnails and the automatic scan interval are configured in **Settings → Playback**.

## Keyboard shortcuts (player)

| Key | Action |
| --- | --- |
| Space / K | Play / pause |
| ← / → | Back / forward 10 seconds |
| ↑ / ↓ | Volume |
| F | Full screen |
| M | Mute |
| Shift + N | Next episode |
| Esc | Back to browsing |

## Security

Home Blockbuster is designed for your home network. Without a password, anyone who can open it can browse the server's folders (in the folder browser), change libraries and settings, and watch your media, so:

- **Set a password** during setup or in **Settings → Security** (or with `HB_PASSWORD`) if other people or untrusted devices share your network. **Never expose it to the internet without one**; ideally use a VPN, or the bundled HTTPS setup with Tailscale or Caddy (see **Docker** above). Each device signs in once for 30 days. Signing out ends that session, and changing the password signs out every device.
- Without a password, the server only answers to IP addresses, `localhost` and LAN names, which blocks DNS-rebinding attacks from websites. If you use another host name, add it to `ALLOWED_HOSTS`, or set a password.
- Symlinks inside a library are only followed when they point into a library folder (or `MEDIA_ROOTS`), so a link dropped into a shared folder can't publish other files on the server. Set `ALLOW_EXTERNAL_SYMLINKS=1` to follow them anyway.
- The **Kids profile is a filter, not a lock**: it hides titles that aren't rated for children (unrated titles must be tagged family/children) and settings, but anyone can switch profiles.
- `state.json` in the data folder holds your API keys and the session secret; it is readable by the server's user only.
- Mount media read-only where you can (the app never writes to your media folders).

## Development

```bash
npm install
npm run dev          # API on :8585 (auto-reload) + Vite dev server on http://localhost:5173
npm test             # unit and integration tests (Vitest)
npm run typecheck
```

```
server/src
├── library/     scanner, filename parser, tag & cover probing, subtitles, presentation
├── metadata/    TMDB, TVmaze, iTunes, OMDb providers, matching, rate-limited HTTP
├── media/       ffmpeg integration, streaming, playback decisions, image cache
├── routes/      REST API (libraries, titles, profiles, playback, settings, auth)
└── shared/      API types shared with the web client
web/src
├── components/  nav, billboard, rows, cards, hover popup, detail modal…
├── pages/       browse, player, profiles, settings, onboarding, search
└── store/       app state (Zustand)
ios/             native iPhone/iPad app (SwiftUI, AVPlayer)
android/         native Android app (Kotlin, Jetpack Compose, Media3/ExoPlayer)
```

## Credits

Metadata and images are provided by [TMDB](https://www.themoviedb.org), [TVmaze](https://www.tvmaze.com) (CC BY-SA), the iTunes Search API and [OMDb](https://www.omdbapi.com). This product uses the TMDB API but is not endorsed or certified by TMDB.

Home Blockbuster is an independent open-source project. It is not affiliated with, endorsed by or connected to Netflix, Inc. or Blockbuster. All trademarks belong to their respective owners.

## License

[MIT](LICENSE)
