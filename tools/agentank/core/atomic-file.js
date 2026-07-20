"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { invariant } = require("./errors");

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeFileAtomic(file, contents, options = {}) {
  ensureDirectory(path.dirname(file));
  if (fs.existsSync(file) && fs.readFileSync(file).equals(Buffer.from(contents))) {
    return { changed: false, file };
  }
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const descriptor = fs.openSync(temporary, "wx", options.mode || 0o600);
  try {
    fs.writeFileSync(descriptor, contents);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    if (typeof options.beforeRename === "function") options.beforeRename(temporary, file);
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return { changed: true, file };
}

function writeJsonAtomic(file, value, options) {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

function writeFileImmutable(file, contents, options = {}) {
  ensureDirectory(path.dirname(file));
  const bytes = Buffer.from(contents);
  if (fs.existsSync(file)) {
    invariant(fs.readFileSync(file).equals(bytes), "IMMUTABLE_ARTIFACT_CONFLICT",
      `immutable artifact already exists with different bytes: ${path.basename(file)}`);
    return { changed: false, file };
  }
  return writeFileAtomic(file, bytes, options);
}

function writeJsonImmutable(file, value, options) {
  return writeFileImmutable(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

module.exports = { ensureDirectory, writeFileAtomic, writeJsonAtomic, writeFileImmutable,
  writeJsonImmutable };
