# Privacy Policy — Home Blockbuster apps

_Last updated: 23 November 2026_

This policy covers the Home Blockbuster apps for Android and iOS ("the app"). The app is a client for a Home Blockbuster server that **you** run on your own computer, NAS or network.

## The short version

The developer of the app collects **no data at all**. The app has no accounts with the developer, no analytics, no advertising, no crash reporting and no third-party tracking SDKs. It only talks to the server addresses you enter.

## What the app stores on your device

- **Server addresses** you add (for example `192.168.1.20:8585`), the last server you used and your in-app settings.
- **Session tokens** for each server, encrypted with a key held in the device's secure keystore (Android Keystore / iOS Keychain).

This data stays on your device. Uninstalling the app deletes it. Android backup is turned off for the app.

## What the app sends, and where

The app sends requests only to the Home Blockbuster servers you add. Those requests include your server password (if you set one), the profile you use, your watch progress, My List and ratings, so that they are shared across your devices. This data is stored on **your** server, under your control. The developer cannot see or access it.

Your server may itself download film and series information and artwork from public metadata services (such as TMDB, OMDb, TVmaze or iTunes) if you configure it to. That is done by the server you run, not by the app, and only sends titles of your media files to look them up.

## Permissions

- **Internet / network state:** to reach your server on your local network or over the internet (for example via Tailscale).

The app does not use your location, contacts, camera, microphone or files outside the app.

## Children

The app is not directed at children under 13 and does not knowingly collect any data from anyone.

## Changes

If this policy changes, the new version is published at this address with a new date.

## Contact

Questions about this policy: open an issue at <https://github.com/swissmarley/home-blockbuster/issues>.

---

## Informativa sulla privacy (italiano)

Lo sviluppatore dell'app **non raccoglie alcun dato**: niente account presso lo sviluppatore, analytics, pubblicità, crash reporting o SDK di tracciamento di terze parti.

Sul dispositivo l'app salva solo gli indirizzi dei server che aggiungi, l'ultimo server usato, le impostazioni dell'app e i token di sessione, cifrati con una chiave del keystore sicuro del dispositivo. Disinstallando l'app vengono eliminati.

L'app comunica solo con i server Home Blockbuster che aggiungi tu, gestiti da te: password del server, profilo, avanzamento della visione, La mia lista e valutazioni restano sul tuo server, e lo sviluppatore non vi ha accesso. L'unico permesso usato è l'accesso a Internet/rete.

Per domande: <https://github.com/swissmarley/home-blockbuster/issues>.
