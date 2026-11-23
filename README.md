# Zippo

A mobile-first web app for bundling files into a `.zip` (optionally AES-256 password protected) or `.tar.gz`. There is no backend. Uploaded files are stored in the browser's IndexedDB and the archive is built on the device.

## Develop

```bash
bun install
bun dev          # http://localhost:3000, hot reload
bun run typecheck
```

To try it on a phone on the same network, open `http://<your-computer-ip>:3000`.

## Deploy

```bash
bun run build    # static site in dist/
```

Upload `dist/` to any static host (Netlify, GitHub Pages, Cloudflare Pages, S3…). `bun start` also serves it.

### GitHub Pages

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds and deploys on every push to `main`, or manually from the Actions tab. One-time setup: in the repo go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. The site is published at `https://<user>.github.io/<repo>/`.

## Layout

- `src/App.tsx`: UI (file list, create sheet)
- `src/db.ts`: IndexedDB storage
- `src/archive.ts`: zip creation (via `@zip.js/zip.js`), tar.gz writer (ustar + PAX, browser `CompressionStream`), download helper
- `src/thumbnail.ts`: image/video thumbnails generated at upload time

## Notes

- Password-protected zips use AES-256. 7-Zip, WinRAR, Keka and most Android file managers open them. The built-in Windows Explorer and macOS Archive Utility do not support AES zips.
- `.tar.gz` has no encryption, so the password option is disabled for that format.
- Archives are built in memory, so very large sets (multiple GB) may hit mobile browser memory limits.
