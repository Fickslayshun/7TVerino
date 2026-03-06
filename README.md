# 7TVFixed

Unofficial 7TV extension fork focused on a faster, cleaner Twitch experience.

This repository is separate from the official 7TV extension. It keeps source code here and ships installable builds through GitHub Releases.

[![Download Latest Build](https://img.shields.io/badge/Download-Latest%20Build-2ea44f?style=for-the-badge)](https://github.com/Fickslayshun/seventvfixed/releases/latest)
[![All Releases](https://img.shields.io/badge/GitHub-Releases-1f6feb?style=for-the-badge)](https://github.com/Fickslayshun/seventvfixed/releases)

## Download

If you just want to install the extension, do not download the source code zip from the repository page.

Use the latest build from the Releases page instead:

-   Open [Releases](https://github.com/Fickslayshun/seventvfixed/releases)
-   Open the newest release
-   Under `Assets`, download the `7tvfixed-...zip` file
-   Extract it somewhere you want to keep it

## Install

### Chrome / Edge / Brave / other Chromium browsers

1. Open `chrome://extensions` or `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the extracted release folder

### Firefox

Firefox manual installs are more restrictive for unsigned extensions. For temporary testing:

1. Open `about:debugging`
2. Click `This Firefox`
3. Click `Load Temporary Add-on`
4. Select the extracted extension's `manifest.json`

## Build Your Own

```bash
yarn install
yarn release:build
```

That creates a release zip in `release-builds/`.

## Notes

-   This is an unofficial fork of the official 7TV extension.
-   The official upstream project lives at [SevenTV/Extension](https://github.com/SevenTV/Extension).
-   This fork is intended to provide an alternative build and distribution path, not to represent the official project.
