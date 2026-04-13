# Zotero PDF/EPUB/HTML reader and annotator

## Build

Clone the repository:

```
git clone https://github.com/zotero/reader --recursive
```

With Node 18+, run the following:

```
NODE_OPTIONS=--openssl-legacy-provider npm i
NODE_OPTIONS=--openssl-legacy-provider npm run build
```

This will produce `dev`, `web` and `zotero` builds in the `build/` directory.

## Development

Run `npm start` and open http://localhost:3000/dev/reader.html.

## Desktop app for Windows (x64)

This repository now includes an Electron wrapper in `desktop/` that turns the reader into a standalone Windows app with:

- file open (`PDF`, `EPUB`, `HTML`)
- drag and drop
- tabbed interface
- theme modes (`Automatic`, `Light`, `Dark`) that follow Windows when set to automatic
- installer-level file associations for `pdf`, `epub`, `html`, and `htm`

Build web assets for desktop:

```bash
npm run build:web
```

Run desktop locally:

```bash
npm run desktop:run
```

Build Windows x64 artifacts (`nsis` installer + `portable`):

```bash
npm run desktop:dist
```

Artifacts are generated in `dist-desktop/`.

