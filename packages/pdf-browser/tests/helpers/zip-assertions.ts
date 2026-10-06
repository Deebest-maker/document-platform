import { unzipSync } from "fflate";

export function inspectZip(bytes: Uint8Array) {
  return unzipSync(bytes);
}
