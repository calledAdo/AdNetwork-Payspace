// Atomic JSON file store — replaces MongoDB for the testing phase.
//
// Files live under DATA_DIR (default ./packages/tracking_payspace_server/data).
// One JSON file per record.
// Placement IDs contain ":" and "/" which are unsafe on some filesystems,
// so they are encoded: ":" → "__", "/" → "--".
//
// Atomic writes: write to a temp file then rename (POSIX rename is atomic).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "./config.js";

const DATA_DIR = path.isAbsolute(config.dataDir)
  ? config.dataDir
  : path.join(process.cwd(), config.dataDir);

// Ensure a collection directory exists.
function collectionPath(collection: string): string {
  const dir = path.join(DATA_DIR, collection);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Encode a record ID into a safe filename.
function encodeId(id: string): string {
  return id.replace(/:/g, "__").replace(/\//g, "--");
}

// Decode a filename back to a record ID.
function decodeId(filename: string): string {
  return filename.replace(/__/g, ":").replace(/--/g, "/").replace(/\.json$/, "");
}

export function readRecord<T>(collection: string, id: string): T | null {
  const file = path.join(collectionPath(collection), `${encodeId(id)}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeRecord<T>(collection: string, id: string, data: T): void {
  const dir  = collectionPath(collection);
  const file = path.join(dir, `${encodeId(id)}.json`);
  const tmp  = path.join(os.tmpdir(), `ps_${encodeId(id)}_${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function deleteRecord(collection: string, id: string): boolean {
  const file = path.join(collectionPath(collection), `${encodeId(id)}.json`);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export function listRecords<T>(collection: string): T[] {
  const dir = collectionPath(collection);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;
        } catch {
          return null;
        }
      })
      .filter((r): r is T => r !== null);
  } catch {
    return [];
  }
}

// Read → transform → write atomically.
export function updateRecord<T>(
  collection: string,
  id: string,
  updater: (current: T | null) => T,
): T {
  const current = readRecord<T>(collection, id);
  const updated = updater(current);
  writeRecord(collection, id, updated);
  return updated;
}

export { decodeId };
