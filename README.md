# Scribd HTML Scraper — GitHub Pages v6

Pure HTML/CSS/JavaScript build for GitHub Pages.

## v6 changes
- Replaces the old grid preview with a large document viewer.
- Previous/next arrows navigate all detected pages.
- Keyboard Left/Right navigation.
- Zoom, Fit, and Full screen controls.
- Thumbnail strip for quick navigation.
- Preview uses the actual rendered HTML viewer page instead of placeholder cards.
- PDF writer explicitly calls `createWritable()` on the FileSystemFileHandle.
- Added `app.js?v=6.0.0` to prevent GitHub Pages/browser cache from serving the old JavaScript.
- PDF pages are streamed one at a time to the selected local file.

## Deploy
Upload `index.html`, `style.css`, `app.js`, and `README.md` to the GitHub Pages repository.
After deployment, hard-refresh with Ctrl+F5 once.

## Browser
Use current Chrome or Edge. The large-file export uses the File System Access API, which requires a secure context such as GitHub Pages HTTPS.

## Access note
Use only HTML/document content you are authorized to access. The project does not bypass authentication, paywalls, DRM, or other access controls.
