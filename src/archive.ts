import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import type { StoredFile } from "./db";

export type ArchiveFormat = "zip" | "tar.gz";
/** "aes" = AES-256 (strong); "zipcrypto" = legacy, weak, but opens in Windows Explorer / macOS. */
export type ZipEncryption = "aes" | "zipcrypto";

export interface ArchiveOptions {
  format: ArchiveFormat;
  /** Only honoured for zip – tar.gz has no encryption. */
  password?: string;
  encryption?: ZipEncryption;
  onProgress?: (fraction: number) => void;
}

/** Gives every entry a unique name: "a.jpg", "a (1).jpg", "a (2).jpg"… */
function uniqueNames(files: StoredFile[]): string[] {
  const used = new Set<string>();
  return files.map(f => {
    const clean = f.name.replace(/[\\/]/g, "_") || "file";
    let name = clean;
    const dot = clean.lastIndexOf(".");
    const base = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : "";
    for (let i = 1; used.has(name.toLowerCase()); i++) name = `${base} (${i})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// Formats that are already compressed – deflating them again just burns battery.
const PRECOMPRESSED =
  /^(image\/(jpeg|png|gif|webp|heic|heif|avif)|video\/|audio\/(mpeg|mp4|aac|ogg|webm)|application\/(zip|gzip|x-7z-compressed|x-rar-compressed|x-bzip2|x-xz|pdf))/;

async function createZip(files: StoredFile[], opts: ArchiveOptions): Promise<Blob> {
  const total = files.reduce((n, f) => n + f.size, 0) || 1;
  const zip = new ZipWriter(new BlobWriter("application/zip"), {
    password: opts.password || undefined,
    zipCrypto: opts.encryption === "zipcrypto",
    encryptionStrength: 3, // AES-256 (ignored for ZipCrypto)
  });
  const names = uniqueNames(files);
  let done = 0;
  for (const [i, f] of files.entries()) {
    await zip.add(names[i]!, new BlobReader(f.blob), {
      lastModDate: new Date(f.lastModified || Date.now()),
      level: PRECOMPRESSED.test(f.type) ? 0 : 6,
      onprogress: async progress => {
        opts.onProgress?.((done + progress) / total);
      },
    });
    done += f.size;
    opts.onProgress?.(done / total);
  }
  return zip.close();
}

// ---------------------------------------------------------------------------
// tar (ustar + PAX for long/unicode names) streamed through gzip

const enc = new TextEncoder();
const BLOCK = 512;

function writeStr(buf: Uint8Array, offset: number, len: number, value: string) {
  buf.set(enc.encode(value).subarray(0, len), offset);
}

function writeOctal(buf: Uint8Array, offset: number, len: number, value: number) {
  writeStr(buf, offset, len, value.toString(8).padStart(len - 1, "0") + "\0");
}

function tarHeader(name: string, size: number, mtime: number, type: "0" | "x"): Uint8Array {
  const h = new Uint8Array(BLOCK);
  writeStr(h, 0, 100, name);
  writeOctal(h, 100, 8, 0o644);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, mtime);
  h.fill(0x20, 148, 156); // checksum placeholder (spaces)
  writeStr(h, 156, 1, type);
  writeStr(h, 257, 6, "ustar\0");
  writeStr(h, 263, 2, "00");
  let sum = 0;
  for (const b of h) sum += b;
  writeStr(h, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  const bodyLen = enc.encode(body).length;
  // The length prefix counts its own digits, so find a self-consistent value.
  let digits = 1;
  while (String(bodyLen + digits).length !== digits) digits++;
  return `${bodyLen + digits}${body}`;
}

const MAX_OCTAL_SIZE = 8 ** 11 - 1;

function padding(size: number): Uint8Array {
  const rem = size % BLOCK;
  return new Uint8Array(rem ? BLOCK - rem : 0);
}

function tarStream(files: StoredFile[], onBytes: (n: number) => void): ReadableStream<Uint8Array> {
  const names = uniqueNames(files);
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (const [i, f] of files.entries()) {
      const name = names[i]!;
      const mtime = Math.floor((f.lastModified || Date.now()) / 1000);
      const nameBytes = enc.encode(name);
      // eslint-disable-next-line no-control-regex
      const needsPax = nameBytes.length > 100 || /[^\x00-\x7f]/.test(name) || f.size > MAX_OCTAL_SIZE;
      if (needsPax) {
        let pax = paxRecord("path", name);
        if (f.size > MAX_OCTAL_SIZE) pax += paxRecord("size", String(f.size));
        const paxBytes = enc.encode(pax);
        yield tarHeader(`PaxHeader/${i}`, paxBytes.length, mtime, "x");
        yield paxBytes;
        yield padding(paxBytes.length);
      }
      const asciiName = name.replace(/[^\x20-\x7e]/g, "_").slice(0, 100);
      yield tarHeader(asciiName, Math.min(f.size, MAX_OCTAL_SIZE), mtime, "0");
      const reader = f.blob.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onBytes(value.byteLength);
        yield value;
      }
      yield padding(f.size);
    }
    yield new Uint8Array(BLOCK * 2); // end-of-archive marker
  }
  const it = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await it.next();
      if (done) controller.close();
      else if (value.byteLength) controller.enqueue(value);
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}

async function createTarGz(files: StoredFile[], opts: ArchiveOptions): Promise<Blob> {
  const total = files.reduce((n, f) => n + f.size, 0) || 1;
  let done = 0;
  const gz = tarStream(files, n => {
    done += n;
    opts.onProgress?.(done / total);
  }).pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  const data = await new Response(gz).blob();
  return new Blob([data], { type: "application/gzip" });
}

// ---------------------------------------------------------------------------

export function createArchive(files: StoredFile[], opts: ArchiveOptions): Promise<Blob> {
  return opts.format === "zip" ? createZip(files, opts) : createTarGz(files, opts);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give mobile browsers time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
