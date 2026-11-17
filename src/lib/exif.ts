/**
 * Reads JPEG EXIF tag 0xA405 (FocalLengthIn35mmFilm) from the raw File header
 * before <canvas> resampling strips camera metadata.
 */
export async function extractExifFocal35mm(file: File): Promise<number | undefined> {
  try {
    const buf = await file.slice(0, 131072).arrayBuffer();
    const view = new DataView(buf);
    const len = view.byteLength;
    if (len < 12 || view.getUint16(0, false) !== 0xffd8) {
      return undefined;
    }

    let pos = 2;
    while (pos + 4 < len) {
      if (view.getUint8(pos) !== 0xff) break;
      while (pos < len && view.getUint8(pos) === 0xff) pos++;
      if (pos >= len) break;

      const marker = view.getUint8(pos);
      pos++;
      if (marker === 0xd9 || marker === 0xda) break;
      if (pos + 2 > len) break;

      const segLen = view.getUint16(pos, false);
      if (segLen < 2 || pos + segLen > len) break;

      if (
        marker === 0xe1 &&
        segLen >= 16 &&
        view.getUint32(pos + 2, false) === 0x45786966 &&
        view.getUint16(pos + 6, false) === 0x0000
      ) {
        const tiff = pos + 8;
        const endianTag = view.getUint16(tiff, false);
        const le = endianTag === 0x4949 ? true : endianTag === 0x4d4d ? false : null;
        if (le === null || view.getUint16(tiff + 2, le) !== 42) return undefined;

        const readExifPointer = (ifdOffset: number, targetTag: number): number | undefined => {
          const base = tiff + ifdOffset;
          if (base + 2 > len) return undefined;
          const count = view.getUint16(base, le);
          for (let i = 0; i < count; i++) {
            const entry = base + 2 + i * 12;
            if (entry + 12 > len) break;
            if (view.getUint16(entry, le) === targetTag) {
              const type = view.getUint16(entry + 2, le);
              const val = type === 3 ? view.getUint16(entry + 8, le) : view.getUint32(entry + 8, le);
              return val;
            }
          }
          return undefined;
        };

        const ifd0Off = view.getUint32(tiff + 4, le);
        const exifOff = readExifPointer(ifd0Off, 0x8769);
        if (exifOff === undefined) return undefined;

        const f35 = readExifPointer(exifOff, 0xa405);
        if (f35 !== undefined && f35 >= 10 && f35 <= 85) {
          return f35;
        }
        return undefined;
      }

      pos += segLen;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
