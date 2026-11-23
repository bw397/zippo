// Generates a small JPEG preview so the list doesn't decode full-size photos.

const THUMB_SIZE = 160;

function drawToJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob | undefined> {
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(undefined);
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(b => resolve(b ?? undefined), "image/jpeg", 0.8));
}

async function imageThumb(file: Blob): Promise<Blob | undefined> {
  // createImageBitmap respects EXIF orientation with this option.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return await drawToJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

function videoThumb(file: Blob): Promise<Blob | undefined> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (b?: Blob) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(b);
    };
    const timer = setTimeout(() => finish(), 5000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) / 2);
    };
    video.onseeked = () => {
      drawToJpeg(video, video.videoWidth, video.videoHeight).then(finish, () => finish());
    };
    video.onerror = () => finish();
    video.src = url;
  });
}

export async function makeThumbnail(file: File): Promise<Blob | undefined> {
  try {
    if (file.type.startsWith("image/")) return await imageThumb(file);
    if (file.type.startsWith("video/")) return await videoThumb(file);
  } catch {
    // Unsupported format (e.g. HEIC outside Safari) – fall back to an icon.
  }
  return undefined;
}
