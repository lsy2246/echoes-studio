const TAR_BLOCK_BYTES = 512;
const decoder = new TextDecoder();

export interface TarArchiveEntry {
  path: string;
  type: "file" | "directory" | "other";
  data: Uint8Array;
}

function text(bytes: Uint8Array, start: number, length: number): string {
  const end = Math.min(bytes.byteLength, start + length);
  let zero = start;
  while (zero < end && bytes[zero] !== 0) zero += 1;
  return decoder.decode(bytes.subarray(start, zero)).trim();
}

function octal(bytes: Uint8Array, start: number, length: number): number {
  const value = text(bytes, start, length).replace(/\0/g, "").trim();
  if (!/^[0-7]+$/.test(value)) return 0;
  return Number.parseInt(value, 8);
}

function paxPath(data: Uint8Array): string | null {
  const value = decoder.decode(data);
  let offset = 0;
  let path: string | null = null;
  while (offset < value.length) {
    const separator = value.indexOf(" ", offset);
    if (separator < 0) break;
    const length = Number.parseInt(value.slice(offset, separator), 10);
    if (!Number.isSafeInteger(length) || length <= 0) break;
    const record = value.slice(separator + 1, offset + length).replace(/\n$/, "");
    const equals = record.indexOf("=");
    if (equals > 0 && record.slice(0, equals) === "path") {
      path = record.slice(equals + 1);
    }
    offset += length;
  }
  return path;
}

/** Walks a ustar/PAX archive without copying every file into memory. */
export function walkTarArchive(
  bytes: Uint8Array,
  visit: (entry: TarArchiveEntry) => void,
): void {
  let offset = 0;
  let nextPath: string | null = null;
  while (offset + TAR_BLOCK_BYTES <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (header.every((value) => value === 0)) return;

    const name = text(header, 0, 100);
    const prefix = text(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const size = octal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.byteLength) throw new Error("GitHub archive is truncated");
    const data = bytes.subarray(dataStart, dataEnd);

    if (typeFlag === "x") {
      nextPath = paxPath(data) ?? nextPath;
    } else if (typeFlag === "L") {
      nextPath = text(data, 0, data.byteLength);
    } else {
      const path = nextPath ?? headerPath;
      nextPath = null;
      visit({
        path,
        type:
          typeFlag === "5"
            ? "directory"
            : typeFlag === "0" || typeFlag === "\0"
              ? "file"
              : "other",
        data,
      });
    }

    offset = dataStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }
  throw new Error("GitHub archive is missing its end marker");
}
