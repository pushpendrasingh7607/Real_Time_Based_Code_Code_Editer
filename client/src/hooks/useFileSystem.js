/**
 * useFileSystem.js — File System Access API + <input> fallback
 *
 * Provides:
 *  - openFile()    → shows native file picker, returns [{name, path, content}]
 *  - openFolder()  → shows native dir picker, returns [{name, path, content, isFolder, folderPath}]
 *  - saveFile()    → triggers browser download of a file
 *
 * Performance optimisations (v2):
 *  - Parallel file reads via Promise.all instead of sequential await loops
 *  - Binary file detection to skip non-text assets fast
 *  - Chunked batching to keep the main thread responsive during large imports
 *
 * Security: File content read via FileReader text API only (no eval, no innerHTML).
 */

/** Detect if the File System Access API is available (Chrome/Edge). */
const supportsFileSystemAPI = typeof window !== 'undefined' && 'showOpenFilePicker' in window;
const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Extensions we know are binary — skip reading their content entirely. */
const BINARY_EXTENSIONS = new Set([
  'png','jpg','jpeg','gif','webp','svg','ico','bmp','tiff',
  'mp4','webm','ogg','mp3','wav','flac',
  'woff','woff2','ttf','eot','otf',
  'zip','gz','tar','rar','7z',
  'pdf','docx','xlsx','pptx',
  'exe','dll','so','dylib','bin','dat',
  'lock',           // package-lock, yarn.lock — huge & not useful in editor
]);

/** Directories to always skip. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'out', '__pycache__', '.cache', 'coverage']);

/**
 * Returns true if the file looks like binary content we should skip.
 */
function isBinaryExtension(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Reads a File object as text, returns a Promise<string>.
 * Rejects quickly for binary files via extension check.
 */
function readFileAsText(file) {
  if (isBinaryExtension(file.name)) {
    return Promise.reject(new Error('binary'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result ?? '');
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Run an array of async tasks in parallel batches of `batchSize`.
 * Keeps the main thread from locking up on huge imports.
 */
async function batchedParallel(items, fn, batchSize = 20) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    results.push(...chunkResults);
    // Yield to the browser between batches
    if (i + batchSize < items.length) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// openFilesPicker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a native file picker and returns selected files.
 * Falls back to hidden <input type="file"> if File System Access API unavailable.
 * @returns {Promise<Array<{name: string, path: string, content: string}>>}
 */
export async function openFilesPicker({ multiple = true } = {}) {
  if (supportsFileSystemAPI) {
    try {
      const handles = await window.showOpenFilePicker({ multiple });
      // Read all picked files in parallel
      const results = await Promise.allSettled(
        handles.map(async (handle) => {
          const file = await handle.getFile();
          const content = await readFileAsText(file);
          return { name: file.name, path: file.name, content };
        })
      );
      return results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);
    } catch (err) {
      if (err.name === 'AbortError') return []; // user cancelled
      // Fall through to input fallback
    }
  }

  // Fallback: hidden <input type="file">
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async () => {
      const fileArr = Array.from(input.files ?? []);
      const settled = await Promise.allSettled(
        fileArr.map(async (file) => {
          const content = await readFileAsText(file);
          return { name: file.name, path: file.name, content };
        })
      );
      document.body.removeChild(input);
      resolve(settled.filter((r) => r.status === 'fulfilled').map((r) => r.value));
    };

    input.oncancel = () => {
      document.body.removeChild(input);
      resolve([]);
    };

    input.click();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// openFolderPicker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a native directory picker and returns all files with their relative paths.
 * Falls back to <input type="file" webkitdirectory> if Directory Picker API unavailable.
 *
 * Performance: files are collected first (metadata only), then read in parallel batches.
 *
 * Returns:
 *   entries: Array<{ name, path, content }> for files
 *   folders: Array<{ name, path, parentPath }> for folders (unique directories)
 */
export async function openFolderPicker() {
  // ── Modern API ──────────────────────────────────────────────────────────
  if (supportsDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });

      // Phase 1: Walk the directory tree collecting (handle, path) pairs — no file reads yet.
      const fileEntries = []; // { handle, path, name }
      const folderSet   = new Set();

      async function walkDir(handle, parentPath = '') {
        const children = [];
        for await (const [name, entry] of handle.entries()) {
          children.push([name, entry]);
        }

        // Process children in parallel (metadata only, no file reads)
        await Promise.all(
          children.map(async ([name, entry]) => {
            // Skip hidden, binary dirs, and common large dirs
            if (name.startsWith('.') || SKIP_DIRS.has(name)) return;

            const entryPath = parentPath ? `${parentPath}/${name}` : name;

            if (entry.kind === 'file') {
              if (!isBinaryExtension(name)) {
                fileEntries.push({ handle: entry, path: entryPath, name });
                if (parentPath) folderSet.add(parentPath);
              }
            } else if (entry.kind === 'directory') {
              folderSet.add(entryPath);
              await walkDir(entry, entryPath);
            }
          })
        );
      }

      await walkDir(dirHandle);

      // Phase 2: Read all file contents in parallel batches
      const settled = await batchedParallel(fileEntries, async ({ handle, path, name }) => {
        const file = await handle.getFile();
        const content = await readFileAsText(file);
        return { name, path, content };
      }, 20);

      const files = settled
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);

      // Build unique ordered folder list
      const allFolderPaths = Array.from(folderSet).sort();
      const folders = allFolderPaths.map((p) => {
        const parts = p.split('/');
        const name = parts[parts.length - 1];
        const parentPath = parts.slice(0, -1).join('/');
        return { name, path: p, parentPath };
      });

      return { files, folders, rootName: dirHandle.name };
    } catch (err) {
      if (err.name === 'AbortError') return { files: [], folders: [], rootName: '' };
      // Fall through to input fallback
    }
  }

  // ── Fallback: <input webkitdirectory> ──────────────────────────────────
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async () => {
      const fileList = Array.from(input.files ?? []);
      document.body.removeChild(input);

      if (fileList.length === 0) {
        return resolve({ files: [], folders: [], rootName: '' });
      }

      const rootName = fileList[0]?.webkitRelativePath?.split('/')[0] ?? 'project';
      const folderSet = new Set();

      // Filter out binary/unwanted files upfront
      const textFiles = fileList.filter((file) => {
        const rel = file.webkitRelativePath;
        if (file.name.startsWith('.')) return false;
        if (SKIP_DIRS.has(rel.split('/')[1])) return false; // skip node_modules etc.
        if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) return false;
        if (isBinaryExtension(file.name)) return false;
        return true;
      });

      // Read all in parallel batches
      const settled = await batchedParallel(textFiles, async (file) => {
        const relParts = file.webkitRelativePath.split('/').slice(1); // remove rootName
        const relPath  = relParts.join('/');
        const content  = await readFileAsText(file);

        // Track parent folders
        for (let i = 1; i < relParts.length; i++) {
          folderSet.add(relParts.slice(0, i).join('/'));
        }

        return { name: file.name, path: relPath, content };
      }, 20);

      const files = settled
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);

      const allFolderPaths = Array.from(folderSet).sort();
      const folders = allFolderPaths.map((p) => {
        const parts      = p.split('/');
        const name       = parts[parts.length - 1];
        const parentPath = parts.slice(0, -1).join('/');
        return { name, path: p, parentPath };
      });

      resolve({ files, folders, rootName });
    };

    input.oncancel = () => {
      document.body.removeChild(input);
      resolve({ files: [], folders: [], rootName: '' });
    };

    input.click();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// saveFileDownload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Triggers a browser download of text content as a file.
 * @param {string} filename
 * @param {string} content
 */
export function saveFileDownload(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
