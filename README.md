# Scribd HTML → PDF v7

Static GitHub Pages build.

## File handling

The chosen HTML is read with the browser File API. It is **not navigated to**
as a webpage and is not opened in a new tab. Drag-and-drop is also handled by
the app so dropping a file cannot cause the browser to navigate to it.

For rendering, the app places the HTML into an off-screen iframe so the
viewer JavaScript can execute. The visible preview is a canvas snapshot of
the document page.

## Preview

- Large actual page preview
- Previous/next arrows
- Keyboard arrows
- Zoom in/out
- Fit
- Full screen
- First 8 page thumbnails

## Large PDF export

The PDF is written page-by-page through the browser File System Access API.
The important distinction is:

`FileSystemFileHandle` → `createWritable()` → `FileSystemWritableFileStream`

Only the writable stream is passed to the PDF writer.

The whole 200+ page PDF is not kept in a single in-memory PDF object.

## GitHub Pages

Upload `index.html`, `style.css`, `app.js`, and `README.md` to the repository.
After deployment, hard-refresh with Ctrl+F5 when replacing an older version.

Use only content you are authorized to access. The project does not bypass
authentication, paywalls, DRM, or other access controls.
