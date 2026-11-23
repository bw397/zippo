import { useEffect, useRef, useState, type FormEvent } from "react";
import { createArchive, downloadBlob, type ArchiveFormat } from "./archive";
import { clearFiles, deleteFile, listFiles, putFile, type StoredFile } from "./db";
import { makeThumbnail } from "./thumbnail";
import "./index.css";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function defaultArchiveName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `files-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 5).toUpperCase() : "FILE";
}

function errorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "QuotaExceededError") {
    return "Your browser ran out of storage space for this file.";
  }
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------

function Thumb({ file }: { file: StoredFile }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file.thumb) return;
    const u = URL.createObjectURL(file.thumb);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file.thumb]);

  if (url) return <img className="thumb" src={url} alt="" />;
  return (
    <div className="thumb thumb-icon" aria-hidden="true">
      {extensionOf(file.name)}
    </div>
  );
}

function FileRow({ file, onDelete }: { file: StoredFile; onDelete: () => void }) {
  return (
    <li className="file-row">
      <Thumb file={file} />
      <div className="file-info">
        <div className="file-name">{file.name}</div>
        <div className="file-size">{formatSize(file.size)}</div>
      </div>
      <button className="btn btn-delete" onClick={onDelete} aria-label={`Delete ${file.name}`}>
        Delete
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------

interface CreateSheetProps {
  files: StoredFile[];
  onClose: () => void;
}

function CreateSheet({ files, onClose }: CreateSheetProps) {
  const [format, setFormat] = useState<ArchiveFormat>("zip");
  const [name, setName] = useState(defaultArchiveName);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ name: string; size: number }>();

  const passwordActive = format === "zip" && usePassword;
  const mismatch = passwordActive && confirm.length > 0 && password !== confirm;
  const passwordInvalid = passwordActive && (password.length === 0 || password !== confirm);
  const creating = progress !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !creating && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, onClose]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (passwordInvalid || creating) return;
    setError(undefined);
    setResult(undefined);
    setProgress(0);
    try {
      const blob = await createArchive(files, {
        format,
        password: passwordActive ? password : undefined,
        onProgress: f => setProgress(Math.min(1, f)),
      });
      const base = (name.trim() || defaultArchiveName()).replace(/\.(zip|tar\.gz|tgz)$/i, "");
      const filename = `${base}.${format}`;
      downloadBlob(blob, filename);
      setResult({ name: filename, size: blob.size });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={() => !creating && onClose()}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onClick={e => e.stopPropagation()}
        onSubmit={handleCreate}
      >
        <div className="sheet-header">
          <h2 id="sheet-title">Create archive</h2>
          <button type="button" className="btn-close" onClick={onClose} disabled={creating} aria-label="Close">
            ×
          </button>
        </div>

        <p className="muted">
          {files.length} {files.length === 1 ? "file" : "files"} · {formatSize(files.reduce((n, f) => n + f.size, 0))}
        </p>

        <fieldset className="field">
          <legend>Format</legend>
          <div className="segmented">
            {(["zip", "tar.gz"] as const).map(f => (
              <label key={f} className={format === f ? "active" : ""}>
                <input
                  type="radio"
                  name="format"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  disabled={creating}
                />
                .{f}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span className="label">File name</span>
          <div className="name-input">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={creating}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <span className="suffix">.{format}</span>
          </div>
        </label>

        <div className="field">
          <label className={`toggle ${format !== "zip" ? "disabled" : ""}`}>
            <input
              type="checkbox"
              checked={passwordActive}
              onChange={e => setUsePassword(e.target.checked)}
              disabled={format !== "zip" || creating}
            />
            <span>Password protect</span>
          </label>
          {format !== "zip" && <p className="hint">.tar.gz files can’t be password protected. Choose .zip for that.</p>}

          {passwordActive && (
            <div className="password-fields">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                disabled={creating}
                autoFocus
              />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Confirm password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={creating}
                aria-invalid={mismatch}
              />
              {mismatch && <p className="error-text">Passwords don’t match.</p>}
              <label className="toggle small">
                <input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} />
                <span>Show password</span>
              </label>
              <p className="hint">Uses AES-256. Open it with 7-Zip, WinRAR, Keka, or most Android file managers.</p>
            </div>
          )}
        </div>

        {error && <p className="error-text">Couldn’t create the archive: {error}</p>}
        {result && (
          <p className="success">
            Downloaded <strong>{result.name}</strong> ({formatSize(result.size)}).
          </p>
        )}

        {creating ? (
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
            <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
            <span>Creating… {Math.round(progress * 100)}%</span>
          </div>
        ) : (
          <button type="submit" className="btn btn-primary btn-block" disabled={passwordInvalid}>
            {result ? "Create again" : "Create"}
          </button>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function App() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(0);
  const [error, setError] = useState<string>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listFiles()
      .then(setFiles)
      .catch(err => setError(`Couldn’t open storage: ${errorMessage(err)}`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list);
    setError(undefined);
    setAdding(n => n + picked.length);
    // Ask the browser not to evict our data under storage pressure.
    navigator.storage?.persist?.().catch(() => {});
    for (const file of picked) {
      try {
        const stored: StoredFile = {
          id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          addedAt: Date.now(),
          blob: file,
          thumb: await makeThumbnail(file),
        };
        await putFile(stored);
        setFiles(prev => [...prev, stored]);
      } catch (err) {
        setError(`Couldn’t add ${file.name}: ${errorMessage(err)}`);
      } finally {
        setAdding(n => n - 1);
      }
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFile(id);
      setFiles(prev => prev.filter(f => f.id !== id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    try {
      await clearFiles();
      setFiles([]);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const totalSize = files.reduce((n, f) => n + f.size, 0);

  return (
    <div className="app">
      <header className="header">
        <h1>Zippo</h1>
        <p className="muted">Bundle files into a .zip or .tar.gz — everything stays on this device.</p>
      </header>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={e => {
          void handleFiles(e.target.files);
          e.target.value = ""; // allow picking the same file again
        }}
      />
      <button className="btn btn-upload btn-block" onClick={() => inputRef.current?.click()}>
        <span className="plus" aria-hidden="true">
          +
        </span>
        Upload files
      </button>

      {error && (
        <p className="error-text banner" role="alert">
          {error}
        </p>
      )}

      <section className="file-section">
        {files.length > 0 && (
          <div className="list-summary">
            {files.length} {files.length === 1 ? "file" : "files"} · {formatSize(totalSize)}
          </div>
        )}
        {loading ? (
          <p className="empty">Loading…</p>
        ) : files.length === 0 && adding === 0 ? (
          <p className="empty">No files yet. Tap “Upload files” to add some.</p>
        ) : (
          <ul className="file-list">
            {files.map(f => (
              <FileRow key={f.id} file={f} onDelete={() => handleDelete(f.id)} />
            ))}
            {adding > 0 && (
              <li className="file-row pending">
                <div className="thumb thumb-icon spinner" aria-hidden="true" />
                <div className="file-info">Adding {adding} {adding === 1 ? "file" : "files"}…</div>
              </li>
            )}
          </ul>
        )}
      </section>

      {files.length > 0 && (
        <footer className="actions">
          <button
            className="btn btn-primary btn-block"
            onClick={() => setSheetOpen(true)}
            disabled={adding > 0}
          >
            Create Zipfile
          </button>
          <button className={`btn btn-block ${confirmClear ? "btn-danger" : "btn-secondary"}`} onClick={handleClear}>
            {confirmClear ? "Tap again to clear all" : "Clear all"}
          </button>
        </footer>
      )}

      {sheetOpen && <CreateSheet files={files} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

export default App;
