#!/bin/sh
# Home Blockbuster installer: sets up the Docker container and the way your devices reach it.
#
#   curl -fsSL https://github.com/swissmarley/home-blockbuster/releases/latest/download/install.sh | sh
#
# Three ways to connect (you are asked, or preset HB_MODE):
#   tailscale  HTTPS through your Tailscale network: real certificate, nothing to install on the iPhone
#   http       plain HTTP on your home network, http://<this-machine>:8585 (no encryption)
#   caddy      HTTPS with your own domain (Let's Encrypt), a private CA, or your own certificate
#
# Re-run it any time to update: your .env and ./data are kept, the images are pulled and restarted.
#
# Everything can be preset with environment variables to run without questions:
#   HB_DIR          install folder                      (default: ~/home-blockbuster)
#   HB_VERSION      release to install, e.g. 1.1.0      (default: latest)
#   HB_MODE         tailscale | http | caddy            (default: asked; caddy if HB_DOMAIN is set)
#   HB_MOVIES_DIR   HB_TV_DIR   folders with your media
#   HB_PASSWORD     password for the app                (generated for public domains)
#   tailscale:      HB_TS_HOSTNAME (default home-blockbuster), HB_TS_AUTHKEY (optional, skips the login link)
#   http:           HB_PORT (default 8585)
#   caddy:          HB_DOMAIN host name(s)/IP(s), comma separated; HB_TLS internal | you@mail.com |
#                   "/certs/cert.pem /certs/key.pem" (default picked from HB_DOMAIN); HB_ACME_EMAIL;
#                   HB_HTTP_PORT / HB_HTTPS_PORT (default 80 / 443)
#   HB_BASE_URL     where to download the deployment files from (advanced)
set -eu

REPO="swissmarley/home-blockbuster"
INSTALL_DIR="${HB_DIR:-$HOME/home-blockbuster}"
VERSION="${HB_VERSION:-latest}"
if [ -n "${HB_BASE_URL:-}" ]; then
  BASE_URL="$HB_BASE_URL"
elif [ "$VERSION" = "latest" ]; then
  BASE_URL="https://github.com/$REPO/releases/latest/download"
else
  BASE_URL="https://github.com/$REPO/releases/download/v${VERSION#v}"
fi

say()  { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die()  { printf 'Error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Questions go to the terminal even when the script itself is piped into sh.
if ( : </dev/tty ) 2>/dev/null; then INTERACTIVE=1; else INTERACTIVE=0; fi

ask() { # ask "question" "default"
  if [ "$INTERACTIVE" = 1 ]; then
    printf '%s [%s]: ' "$1" "$2" >/dev/tty
    IFS= read -r answer </dev/tty || answer=""
    [ -n "$answer" ] && printf '%s' "$answer" || printf '%s' "$2"
  else
    printf '%s' "$2"
  fi
}

# --- Requirements ---------------------------------------------------------------------------
have curl   || die "curl is required."
have docker || die "Docker is not installed. Get it from https://docs.docker.com/get-docker/ and run this again."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (the 'docker compose' command). See https://docs.docker.com/compose/install/"
docker info >/dev/null 2>&1 || die "Cannot talk to the Docker daemon. Start Docker, or add your user to the docker group (or run this with sudo)."

mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/certs"
cd "$INSTALL_DIR"
say "Installing into $INSTALL_DIR"

# --- Deployment files -----------------------------------------------------------------------
fetch() { # fetch remote-name local-name
  curl -fsSL "$BASE_URL/$1" -o "$2.part" || { rm -f "$2.part"; die "Could not download $BASE_URL/$1"; }
  mv "$2.part" "$2"
}
fetch docker-compose.deploy.yml docker-compose.yml
fetch Caddyfile Caddyfile
fetch tailscale-serve.json tailscale-serve.json

# --- Helpers --------------------------------------------------------------------------------
env_get() { sed -n "s/^$1=//p" .env | tail -n 1 | sed "s/^'//; s/'\$//"; }
env_quote() { # value for .env: single-quoted so $ and spaces are taken literally
  case "$1" in *\'*) die "Values cannot contain a single quote: $1" ;; esac
  printf "'%s'" "$1"
}
abs_dir() { # expand ~ and make absolute; the folder must exist
  d="$1"
  case "$d" in "~") d="$HOME" ;; "~/"*) d="$HOME/${d#"~/"}" ;; esac
  [ -d "$d" ] || die "Folder not found: $d"
  (cd "$d" && pwd)
}
is_public_name() { # true when Let's Encrypt can issue for it (a real DNS name, not a LAN name or IP)
  case "$1" in
    localhost|*.localhost|*.local|*.lan|*.home|*.home.arpa|*.internal|*.localdomain|*.intranet|*.private|*.test) return 1 ;;
    *[!0-9.]*) ;;      # has letters: a name (or IPv6)
    *) return 1 ;;     # only digits and dots: IPv4
  esac
  case "$1" in *:*) return 1 ;; esac
  case "$1" in *.*) return 0 ;; *) return 1 ;; esac
}
random_password() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20; }
detect_tz() {
  tz=""
  if [ -L /etc/localtime ]; then tz=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||'); fi
  [ -z "$tz" ] && [ -r /etc/timezone ] && tz=$(cat /etc/timezone)
  printf '%s' "${tz:-UTC}"
}
lan_ip() {
  ip=""
  if have hostname; then ip=$(hostname -I 2>/dev/null | awk '{print $1}'); fi
  [ -z "$ip" ] && have ipconfig && ip=$(ipconfig getifaddr en0 2>/dev/null || true)
  printf '%s' "$ip"
}

# --- Configuration (first run only) ---------------------------------------------------------
if [ -f .env ]; then
  say "Keeping your existing configuration (.env)."
  if ! grep -q '^COMPOSE_PROFILES=' .env; then
    # An install from release 1.0.0 always used Caddy: keep it working with the profile-based compose file.
    say "Upgrading the configuration of an earlier install (HTTPS with Caddy)."
    {
      echo ""
      echo "# Added when upgrading from 1.0.0"
      echo "COMPOSE_PROFILES=caddy"
      echo "HB_BIND=127.0.0.1"
      echo "HB_TRUST_PROXY=1"
      echo "HB_ALLOWED_HOSTS=$(env_quote "$(env_get HB_DOMAIN)")"
    } >> .env
  fi
else
  say ""
  MODE="${HB_MODE:-}"
  if [ -z "$MODE" ] && [ -n "${HB_DOMAIN:-}" ]; then MODE=caddy; fi
  if [ -z "$MODE" ]; then
    say "How should your devices connect?"
    say "  1) Tailscale  HTTPS with a real certificate, nothing to install on the iPhone (recommended)"
    say "  2) HTTP       plain HTTP on your home network (no encryption)"
    say "  3) Caddy      HTTPS with your own domain, a private certificate authority, or your own certificate"
    case $(ask "Choose 1, 2 or 3" "1") in
      2|http) MODE=http ;;
      3|caddy) MODE=caddy ;;
      *) MODE=tailscale ;;
    esac
  fi
  case "$MODE" in tailscale|http|caddy) ;; *) die "HB_MODE must be tailscale, http or caddy (got: $MODE)" ;; esac

  PASSWORD="${HB_PASSWORD:-}"
  BIND=127.0.0.1; PORT="${HB_PORT:-8585}"; TRUST_PROXY=1; ALLOWED=""
  DOMAIN=localhost; TLS=internal; HTTP_PORT="${HB_HTTP_PORT:-80}"; HTTPS_PORT="${HB_HTTPS_PORT:-443}"
  TS_HOSTNAME="${HB_TS_HOSTNAME:-home-blockbuster}"; TS_AUTHKEY="${HB_TS_AUTHKEY:-}"

  case "$MODE" in
    tailscale)
      ALLOWED=".ts.net"
      say ""
      say "Tailscale needs a free account and the Tailscale app on the devices that will watch."
      say "One-time, in the admin console (https://login.tailscale.com/admin/dns): turn on MagicDNS and HTTPS Certificates."
      ;;
    http)
      BIND=0.0.0.0; TRUST_PROXY=""
      ;;
    caddy)
      ALLOWED=""
      DOMAIN="${HB_DOMAIN:-}"
      if [ -z "$DOMAIN" ]; then
        say ""
        say "Devices must open the app with exactly this name, e.g. nas.local, 192.168.1.20 or media.example.com."
        say "Use several separated by commas, e.g. nas.local, 192.168.1.20."
        DOMAIN=$(ask "Host name or IP address" "localhost")
      fi
      DOMAIN=$(printf '%s' "$DOMAIN" | sed 's/[[:space:]]*,[[:space:]]*/, /g; s/^[[:space:]]*//; s/[[:space:]]*$//')
      [ -n "$DOMAIN" ] || die "A host name or IP address is required."
      PRIMARY=${DOMAIN%%,*}
      ALLOWED="$DOMAIN"
      if [ -n "${HB_TLS:-}" ]; then
        TLS="$HB_TLS"
      elif is_public_name "$PRIMARY"; then
        EMAIL="${HB_ACME_EMAIL:-}"
        while :; do
          [ -n "$EMAIL" ] || EMAIL=$(ask "E-mail for Let's Encrypt certificate notices" "")
          case "$EMAIL" in *@*.*) break ;; esac
          [ "$INTERACTIVE" = 1 ] || die "$PRIMARY is a public name: set HB_ACME_EMAIL (or HB_TLS) to get a Let's Encrypt certificate."
          EMAIL=""
        done
        TLS="$EMAIL"
        say "Let's Encrypt needs ports 80 and 443 on this machine to be reachable from the internet."
      else
        TLS="internal"
      fi
      # Anything reachable from the internet must not run without a password.
      if [ "$TLS" != internal ] && [ -z "$PASSWORD" ]; then
        PASSWORD=$(random_password)
        GENERATED_PASSWORD=1
      fi
      ;;
  esac

  MOVIES_DEFAULT="$INSTALL_DIR/media/movies"; TV_DEFAULT="$INSTALL_DIR/media/tv"
  MOVIES="${HB_MOVIES_DIR:-}"; TV="${HB_TV_DIR:-}"
  if [ -z "$MOVIES" ]; then MOVIES=$(ask "Folder with your movies" "$MOVIES_DEFAULT"); fi
  if [ -z "$TV" ]; then TV=$(ask "Folder with your TV shows" "$TV_DEFAULT"); fi
  [ "$MOVIES" = "$MOVIES_DEFAULT" ] && mkdir -p "$MOVIES_DEFAULT"
  [ "$TV" = "$TV_DEFAULT" ] && mkdir -p "$TV_DEFAULT"
  MOVIES=$(abs_dir "$MOVIES"); TV=$(abs_dir "$TV")

  if [ "$INTERACTIVE" = 1 ] && [ -z "$PASSWORD" ]; then
    PASSWORD=$(ask "Password for the app (empty = none, you can set one later in Settings → Security)" "")
  fi

  umask 077
  {
    echo "# Written by install.sh. Edit and run 'docker compose up -d' to apply."
    echo "COMPOSE_PROFILES=$MODE"
    echo "HB_VERSION=$VERSION"
    echo "TZ=$(detect_tz)"
    echo "HB_BIND=$BIND"
    echo "HB_PORT=$PORT"
    echo "HB_TRUST_PROXY=$TRUST_PROXY"
    echo "HB_ALLOWED_HOSTS=$(env_quote "$ALLOWED")"
    echo "HB_TS_HOSTNAME=$(env_quote "$TS_HOSTNAME")"
    echo "HB_TS_AUTHKEY=$(env_quote "$TS_AUTHKEY")"
    echo "HB_DOMAIN=$(env_quote "$DOMAIN")"
    echo "HB_TLS=$(env_quote "$TLS")"
    echo "HB_HTTP_PORT=$HTTP_PORT"
    echo "HB_HTTPS_PORT=$HTTPS_PORT"
    echo "HB_MOVIES_DIR=$(env_quote "$MOVIES")"
    echo "HB_TV_DIR=$(env_quote "$TV")"
    echo "HB_PASSWORD=$(env_quote "$PASSWORD")"
    echo "TMDB_API_KEY=$(env_quote "${TMDB_API_KEY:-}")"
    echo "OMDB_API_KEY=$(env_quote "${OMDB_API_KEY:-}")"
  } > .env
  chmod 600 .env
  say "Saved .env"
fi

# --- Start ----------------------------------------------------------------------------------
say ""
say "Downloading images and starting the containers…"
docker compose pull || warn "Could not pull the latest images; continuing with the ones already on this machine."
docker compose up -d

MODE=$(env_get COMPOSE_PROFILES); MODE=${MODE%%,*}
PORT=$(env_get HB_PORT); PORT=${PORT:-8585}

wait_for() { # wait_for description command...
  desc="$1"; shift
  printf '%s' "$desc"
  for _ in $(seq 1 60); do
    if "$@" >/dev/null 2>&1; then echo; return 0; fi
    printf '.'; sleep 2
  done
  echo; return 1
}

say ""
case "$MODE" in
  http)
    wait_for "Waiting for the server" curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" \
      || warn "The server did not answer yet. Check 'docker compose logs' in $INSTALL_DIR."
    IP=$(lan_ip)
    say "Home Blockbuster is running: http://${IP:-<server-address>}:$PORT"
    say "This is plain HTTP: passwords and video can be read by anyone on your network. Fine on a trusted home"
    say "network; for encryption re-run the installer in a new folder and choose Tailscale or Caddy."
    ;;

  tailscale)
    # Compact JSON of `tailscale status` (no newlines or spaces) for simple field extraction.
    ts_status() { docker compose exec -T tailscale tailscale status --json 2>/dev/null | tr -d '\n '; }
    ts_field() { ts_status | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }
    announced=""; running=0
    printf 'Waiting for Tailscale'
    for _ in $(seq 1 150); do
      state=$(ts_field BackendState)
      if [ "$state" = Running ]; then running=1; break; fi
      auth=$(ts_field AuthURL)
      if [ -n "$auth" ] && [ "$announced" != "$auth" ]; then
        announced="$auth"
        printf '\n\nSign in to Tailscale to connect this server to your network:\n  %s\n\nWaiting' "$auth"
      fi
      printf '.'; sleep 2
    done
    echo
    if [ "$running" != 1 ]; then
      warn "Tailscale is not connected yet. Open the login link from 'docker compose logs tailscale' in $INSTALL_DIR, then re-run this installer."
      exit 0
    fi
    CERT_DOMAIN=$(ts_status | sed -n 's/.*"CertDomains":\["\([^"]*\)".*/\1/p')
    say ""
    if [ -n "$CERT_DOMAIN" ]; then
      say "Home Blockbuster is running: https://$CERT_DOMAIN"
      say "Open it on any device signed in to your Tailscale network (the first request can take a few seconds while the certificate is issued)."
    else
      say "Tailscale is connected, but HTTPS certificates are not enabled for your network yet."
      say "Turn on MagicDNS and HTTPS Certificates at https://login.tailscale.com/admin/dns, then run: docker compose restart tailscale"
      say "The app will then be at https://$(env_get HB_TS_HOSTNAME).<your-tailnet>.ts.net"
    fi
    say "In the iOS app, add the server with that full https:// address. Install Tailscale on the iPhone and sign in with the same account."
    ;;

  caddy)
    DOMAIN=$(env_get HB_DOMAIN); DOMAIN=${DOMAIN:-localhost}
    TLS=$(env_get HB_TLS); TLS=${TLS:-internal}
    HTTPS_PORT=$(env_get HB_HTTPS_PORT); HTTPS_PORT=${HTTPS_PORT:-443}
    PRIMARY=${DOMAIN%%,*}
    URL="https://$PRIMARY"
    [ "$HTTPS_PORT" = 443 ] || URL="$URL:$HTTPS_PORT"
    wait_for "Waiting for the server" curl -fsSk --max-time 3 --resolve "$PRIMARY:$HTTPS_PORT:127.0.0.1" "$URL/api/health" \
      || warn "The server did not answer yet. Check 'docker compose logs' in $INSTALL_DIR."

    CA_FILE=""
    if [ "$TLS" = internal ]; then
      # Caddy creates its local CA the first time it serves a certificate; export it for your devices.
      for _ in $(seq 1 15); do
        if docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./home-blockbuster-root-ca.crt >/dev/null 2>&1; then
          CA_FILE="$INSTALL_DIR/home-blockbuster-root-ca.crt"; break
        fi
        sleep 1
      done
    fi
    say "Home Blockbuster is running: $URL"
    if [ -n "$CA_FILE" ]; then
      cat <<EOF

The certificate comes from a private CA on this machine, so each device must trust it once:
  $CA_FILE
  - iPhone/iPad: send the file to the device (AirDrop, Files), open it, then Settings → Profile Downloaded → Install,
                 and finally Settings → General → About → Certificate Trust Settings → switch it on.
  - macOS:       sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA_FILE"
  - Windows:     certutil -addstore -f Root home-blockbuster-root-ca.crt   (in an administrator prompt)
  - Android:     Settings → Security → Encryption & credentials → Install a certificate → CA certificate
  - Linux:       copy it to /usr/local/share/ca-certificates/ and run sudo update-ca-certificates
In the iOS app, add the server as $URL (including https://).
EOF
    fi
    ;;
  *)
    warn "Unknown COMPOSE_PROFILES value in .env: '$MODE' (expected tailscale, http or caddy)."
    ;;
esac

if [ -n "${GENERATED_PASSWORD:-}" ]; then
  say ""
  say "Password (also in $INSTALL_DIR/.env): $PASSWORD"
fi
say ""
say "Manage it from $INSTALL_DIR:  docker compose logs -f | docker compose down | re-run this installer to update."
