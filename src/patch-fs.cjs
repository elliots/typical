// logs all readFile and readFileSync calls (for debugging)

const fs = require("fs");
const fsp = require("fs/promises");

// monkeypatch promises/readFile
const origFspReadFile = fsp.readFile;
fsp.readFile = async function (path, ...args) {
  console.log("fsp.readFile", path);
  return origFspReadFile.call(this, path, ...args);
};

// monkeypatch readFile
const origFsReadFile = fs.readFile;
fs.readFile = async function (path, ...args) {
  console.log("fs.readFile", path);
  return origFsReadFile.call(this, path, ...args);
};

// monkeypatch readFileSync
const origFsReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  console.log("fs.readFileSync", path);
  return origFsReadFileSync.call(this, path, ...args);
};
