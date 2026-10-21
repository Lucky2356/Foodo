import { registerPlugin } from '@capacitor/core';

/**
 * Saving exports in the Android app (native FoodoFiles plugin). The Android WebView ignores
 * `<a download>` for blob: URLs, so the file goes to the system «Сохранить» dialog instead.
 */
interface FoodoFilesPlugin {
  save(options: { filename: string; mimeType: string; base64: string }): Promise<{ saved: boolean }>;
}

const FoodoFiles = registerPlugin<FoodoFilesPlugin>('FoodoFiles');

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Returns false if the user closed the dialog without saving. */
export async function saveFileNative(filename: string, blob: Blob): Promise<boolean> {
  const mimeType = blob.type.split(';')[0] ?? '';
  try {
    const { saved } = await FoodoFiles.save({ filename, mimeType, base64: await toBase64(blob) });
    return saved;
  } catch {
    throw new Error('Не удалось сохранить файл на телефоне. Попробуйте ещё раз.');
  }
}
