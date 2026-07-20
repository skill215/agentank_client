"use strict";

const crypto = require("node:crypto");
const { canonicalJson, withoutTopLevelFingerprint } = require("./canonical-json");

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function fingerprintObject(value) {
  return sha256Text(canonicalJson(withoutTopLevelFingerprint(value)));
}

function fingerprintObjectOmitting(value, fields) {
  const copy = { ...withoutTopLevelFingerprint(value) };
  for (const field of fields) delete copy[field];
  return sha256Text(canonicalJson(copy));
}

module.exports = { sha256Bytes, sha256Text, fingerprintObject, fingerprintObjectOmitting };
