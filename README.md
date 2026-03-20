# 7TVerino

Unofficial 7TV extension fork blending 7TV and a Chatterino-style Twitch workflow with a focus on performance, QoL, and a faster native experience.

7TVerino merges 7TV and a Chatterino-style multi-channel chat workflow into one native Twitch extension focused on performance and quality-of-life improvements. The goal is to keep Twitch feeling native while adding tabbed chat, faster tools, and practical upgrades without leaving the site.

This repository is separate from the official 7TV extension. It keeps the source here and ships installable builds through GitHub Releases.

[![Download Chromium Build](https://img.shields.io/badge/Download-Chromium%20Build-2ea44f?style=for-the-badge)](https://github.com/Fickslayshun/7TVerino/releases/download/7tverino/7tverino.zip)
[![Download Firefox Build](https://img.shields.io/badge/Download-Firefox%20Build-ff7139?style=for-the-badge)](https://github.com/Fickslayshun/7TVerino/releases/download/7tverino/7tverino-firefox.zip)
[![All Releases](https://img.shields.io/badge/GitHub-Releases-1f6feb?style=for-the-badge)](https://github.com/Fickslayshun/7TVerino/releases)

## What Is 7TVerino?

- Native Twitch extension experience with a unified chat, input, and settings flow
- Chatterino-style multi-channel chat tabs built directly into Twitch, with performance and QoL as a core focus
- 7TV-based performance and quality-of-life improvements without needing a separate desktop client

## Download

If you just want to install the extension, do not download the source code zip from the repository page.

Use the stable `7tverino` release instead:

-   Open [the `7tverino` release](https://github.com/Fickslayshun/7TVerino/releases/tag/7tverino)
-   Chromium browsers: download [7tverino.zip](https://github.com/Fickslayshun/7TVerino/releases/download/7tverino/7tverino.zip)
-   Firefox: download [7tverino-firefox.zip](https://github.com/Fickslayshun/7TVerino/releases/download/7tverino/7tverino-firefox.zip)
-   Extract it somewhere you want to keep it

## Install

### Chrome / Edge / Brave / other Chromium browsers

1. Open `chrome://extensions` or `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Extract `7tverino.zip`
5. Select the extracted `7tverino` folder
6. Make sure that folder contains `manifest.json` directly inside it

### Firefox

Firefox manual installs are more restrictive for unsigned extensions. The GitHub Firefox build is an MV2 temporary-testing package, so it must be loaded through `about:debugging` after extraction:

1. Open `about:debugging`
2. Click `This Firefox`
3. Click `Load Temporary Add-on`
4. Extract `7tverino-firefox.zip`
5. Open the extracted `7tverino-firefox` folder
6. Select its `manifest.json`
7. If you do not see `manifest.json`, you are in the wrong folder

Permanent Firefox installs still require a signed AMO build. The GitHub asset is for temporary/manual testing only.

## Build Your Own

```bash
yarn install
yarn release:build
```

That creates browser-specific release zips in `release-builds/`.

Every push to `main` also refreshes the public GitHub release tagged `7tverino`.

## Notes

-   This is an unofficial fork of the official 7TV extension.
-   The official upstream project lives at [SevenTV/Extension](https://github.com/SevenTV/Extension).
-   This fork is intended to provide an alternative build and distribution path, not to represent the official project.
