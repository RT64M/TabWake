import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORED_METHOD = 0;
const ZIP_DOS_DATE = 0x0021;

const SHARED_RUNTIME_PATHS = [
  "_locales",
  "icons",
  "popup",
  "src/alarm-names.js",
  "src/background.js",
  "src/background",
  "src/extension-api.js",
  "src/latest-content.js",
  "src/latest-url-rules.js",
  "src/rules.js",
  "src/storage.js",
  "src/url-utils.js",
];

const STORE_TARGETS = {
  chrome: {
    label: "Chrome",
    baseManifest: "manifest.json",
    manifestOverride: "packaging/chrome/manifest.override.json",
  },
  edge: {
    label: "Edge",
    baseManifest: "manifest.json",
    manifestOverride: "packaging/edge/manifest.override.json",
  },
};

function projectPath(relativePath, projectRootUrl = projectRoot) {
  return new URL(relativePath, projectRootUrl);
}

async function readJson(relativePath, projectRootUrl = projectRoot) {
  return JSON.parse(await readFile(projectPath(relativePath, projectRootUrl), "utf8"));
}

export function assertManifestVersionsMatch(packageVersion, manifestVersions) {
  for (const [manifestPath, manifestVersion] of Object.entries(manifestVersions)) {
    if (manifestVersion !== packageVersion) {
      throw new Error(
        `package.json version ${packageVersion} must match ${manifestPath} version ${manifestVersion}`
      );
    }
  }
}

export async function assertSourceManifestVersionsMatch({ projectRootUrl = projectRoot } = {}) {
  const packageJson = await readJson("package.json", projectRootUrl);
  const chromiumManifest = await readJson("manifest.json", projectRootUrl);

  assertManifestVersionsMatch(packageJson.version, {
    "manifest.json": chromiumManifest.version,
  });

  return packageJson.version;
}

function mergeJson(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = mergeJson(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export async function assertStoreManifestVersionsMatch({
  projectRootUrl = projectRoot,
  packageVersion,
} = {}) {
  const releaseVersion =
    packageVersion ?? (await assertSourceManifestVersionsMatch({ projectRootUrl }));
  const chromiumManifest = await readJson("manifest.json", projectRootUrl);
  const chromeManifestOverride = await readJson(
    "packaging/chrome/manifest.override.json",
    projectRootUrl
  );
  const edgeManifestOverride = await readJson(
    "packaging/edge/manifest.override.json",
    projectRootUrl
  );

  assertManifestVersionsMatch(releaseVersion, {
    "Chrome package manifest": mergeJson(chromiumManifest, chromeManifestOverride).version,
    "Edge package manifest": mergeJson(chromiumManifest, edgeManifestOverride).version,
  });

  return releaseVersion;
}

async function copyRuntimeFiles(
  targetDirectoryUrl,
  extraRuntimePaths = [],
  projectRootUrl = projectRoot
) {
  for (const relativePath of [...SHARED_RUNTIME_PATHS, ...extraRuntimePaths]) {
    await cp(projectPath(relativePath, projectRootUrl), new URL(relativePath, targetDirectoryUrl), {
      recursive: true,
      force: true,
    });
  }
}

async function writeTargetManifest(targetName, targetDirectoryUrl, projectRootUrl) {
  const target = STORE_TARGETS[targetName];
  const baseManifest = await readJson(target.baseManifest, projectRootUrl);
  const manifest = target.manifestOverride
    ? mergeJson(baseManifest, await readJson(target.manifestOverride, projectRootUrl))
    : baseManifest;

  await writeFile(
    new URL("manifest.json", targetDirectoryUrl),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(buffer) {
  let value = 0xffffffff;

  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function assertZipUint32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} is too large for a standard ZIP archive`);
  }
}

function childPathUrl(directoryUrl, childName, isDirectory = false) {
  const childPath = path.join(fileURLToPath(directoryUrl), childName);
  return pathToFileURL(isDirectory ? `${childPath}${path.sep}` : childPath);
}

export async function collectZipFiles(directoryUrl, relativePrefix = "") {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const files = [];
  for (const entry of entries) {
    const relativePath = `${relativePrefix}${entry.name}`;

    if (entry.isDirectory()) {
      files.push(
        ...(await collectZipFiles(childPathUrl(directoryUrl, entry.name, true), `${relativePath}/`))
      );
    } else if (entry.isFile()) {
      files.push({
        name: relativePath,
        data: await readFile(childPathUrl(directoryUrl, entry.name)),
      });
    } else {
      throw new Error(`Unsupported package file type: ${relativePath}`);
    }
  }

  return files;
}

function buildStoredZipArchive(files) {
  const localFileParts = [];
  const centralDirectoryParts = [];
  let localFileOffset = 0;

  for (const file of files) {
    const fileName = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.data);
    const checksum = crc32(data);
    assertZipUint32(fileName.length, `${file.name} filename`);
    assertZipUint32(data.length, `${file.name} size`);
    assertZipUint32(localFileOffset, "ZIP local file offset");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_STORED_METHOD, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localFileParts.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_STORED_METHOD, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localFileOffset, 42);
    centralDirectoryParts.push(centralHeader, fileName);

    localFileOffset += localHeader.length + fileName.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralDirectoryParts);
  assertZipUint32(localFileOffset, "ZIP central directory offset");
  assertZipUint32(centralDirectory.length, "ZIP central directory size");
  if (files.length > 0xffff) {
    throw new Error("Too many files for a standard ZIP archive");
  }

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(files.length, 8);
  endOfCentralDirectory.writeUInt16LE(files.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(localFileOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localFileParts, centralDirectory, endOfCentralDirectory]);
}

async function zipDirectory(sourceDirectoryUrl, zipPath) {
  const files = await collectZipFiles(sourceDirectoryUrl);
  await rm(zipPath, { force: true });
  await writeFile(zipPath, buildStoredZipArchive(files));
}

function assertArchiveRange(archive, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > archive.length) {
    throw new Error(`Invalid ZIP ${label}`);
  }
}

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 0xffff - 22);

  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("Invalid ZIP end of central directory");
}

function readZipDirectory(archive) {
  const endOffset = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
  assertArchiveRange(archive, centralDirectoryOffset, centralDirectorySize, "central directory");

  const entries = new Map();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assertArchiveRange(archive, offset, 46, "central directory entry");
    if (archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP central directory entry signature");
    }

    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const checksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const filenameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const entryLength = 46 + filenameLength + extraLength + commentLength;
    assertArchiveRange(archive, offset, entryLength, "central directory filename");
    const filename = Buffer.from(archive.subarray(offset + 46, offset + 46 + filenameLength));
    const name = filename.toString("utf8");

    entries.set(name, {
      checksum,
      compressedSize,
      compressionMethod,
      extraLength,
      filename,
      flags,
      localHeaderOffset,
      uncompressedSize,
    });
    offset += entryLength;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error("Invalid ZIP central directory size");
  }

  return entries;
}

export async function listZipEntries(zipPath) {
  const archive = await readFile(zipPath);
  return [...readZipDirectory(archive).keys()].sort();
}

export async function readZipEntry(zipPath, entryPath) {
  const archive = await readFile(zipPath);
  const entry = readZipDirectory(archive).get(entryPath);
  if (!entry) {
    throw new Error(`ZIP entry not found: ${entryPath}`);
  }
  if (entry.flags !== ZIP_UTF8_FLAG) {
    throw new Error(`Unsupported ZIP flags for ${entryPath}`);
  }
  if (entry.compressionMethod !== ZIP_STORED_METHOD) {
    throw new Error(`Unsupported ZIP compression method for ${entryPath}`);
  }
  if (entry.extraLength !== 0) {
    throw new Error(`Unsupported ZIP central directory extra data for ${entryPath}`);
  }
  if (entry.compressedSize !== entry.uncompressedSize) {
    throw new Error(`Invalid stored ZIP sizes for ${entryPath}`);
  }

  assertArchiveRange(archive, entry.localHeaderOffset, 30, "local file header");
  if (archive.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`Invalid ZIP local file header for ${entryPath}`);
  }

  const flags = archive.readUInt16LE(entry.localHeaderOffset + 6);
  const compressionMethod = archive.readUInt16LE(entry.localHeaderOffset + 8);
  const checksum = archive.readUInt32LE(entry.localHeaderOffset + 14);
  const compressedSize = archive.readUInt32LE(entry.localHeaderOffset + 18);
  const uncompressedSize = archive.readUInt32LE(entry.localHeaderOffset + 22);
  const filenameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
  assertArchiveRange(
    archive,
    entry.localHeaderOffset + 30,
    filenameLength + extraLength,
    "local filename"
  );
  const filename = archive.subarray(
    entry.localHeaderOffset + 30,
    entry.localHeaderOffset + 30 + filenameLength
  );

  if (flags !== entry.flags) {
    throw new Error(`local ZIP flags mismatch for ${entryPath}`);
  }
  if (compressionMethod !== entry.compressionMethod) {
    throw new Error(`local ZIP compression method mismatch for ${entryPath}`);
  }
  if (checksum !== entry.checksum) {
    throw new Error(`local ZIP CRC mismatch for ${entryPath}`);
  }
  if (compressedSize !== entry.compressedSize) {
    throw new Error(`local ZIP compressed size mismatch for ${entryPath}`);
  }
  if (uncompressedSize !== entry.uncompressedSize) {
    throw new Error(`local ZIP uncompressed size mismatch for ${entryPath}`);
  }
  if (!filename.equals(entry.filename)) {
    throw new Error(`local ZIP filename mismatch for ${entryPath}`);
  }
  if (extraLength !== 0) {
    throw new Error(`Unsupported ZIP local extra data for ${entryPath}`);
  }

  const dataOffset = entry.localHeaderOffset + 30 + filenameLength + extraLength;
  assertArchiveRange(archive, dataOffset, entry.compressedSize, "entry data");
  const data = Buffer.from(archive.subarray(dataOffset, dataOffset + entry.compressedSize));

  if (data.length !== entry.uncompressedSize || crc32(data) !== entry.checksum) {
    throw new Error(`Invalid ZIP data for ${entryPath}`);
  }

  return data;
}

async function packageTarget(targetName, options) {
  const target = STORE_TARGETS[targetName];
  if (!target) {
    throw new Error(`Unknown package target: ${targetName}`);
  }

  const stagingDirectoryUrl = new URL(`${targetName}/`, options.stagingRootUrl);
  const zipFileUrl = new URL(
    `tabwake-${targetName}-${options.packageVersion}.zip`,
    options.outputRootUrl
  );

  await rm(stagingDirectoryUrl, { recursive: true, force: true });
  await mkdir(stagingDirectoryUrl, { recursive: true });
  await copyRuntimeFiles(
    stagingDirectoryUrl,
    target.extraRuntimePaths,
    options.projectRootUrl
  );
  await writeTargetManifest(targetName, stagingDirectoryUrl, options.projectRootUrl);
  await zipDirectory(stagingDirectoryUrl, zipFileUrl);

  return {
    target: targetName,
    label: target.label,
    zip: path
      .relative(fileURLToPath(options.projectRootUrl), fileURLToPath(zipFileUrl))
      .split(path.sep)
      .join("/"),
  };
}

export async function packageStoreTargets(command = "stores", options = {}) {
  const projectRootUrl = options.projectRootUrl ?? projectRoot;
  const outputRootUrl = options.outputRootUrl ?? new URL("output/store-packages/", projectRootUrl);
  const stagingRootUrl = options.stagingRootUrl ?? new URL("staging/", outputRootUrl);
  const targetNames = command === "stores" ? Object.keys(STORE_TARGETS) : [command];
  const packageVersion = await assertSourceManifestVersionsMatch({ projectRootUrl });

  await assertStoreManifestVersionsMatch({ projectRootUrl, packageVersion });
  await mkdir(outputRootUrl, { recursive: true });
  await mkdir(stagingRootUrl, { recursive: true });
  const stagingDirectory = await mkdtemp(
    path.join(fileURLToPath(stagingRootUrl), "run-")
  );
  const stagingRunUrl = pathToFileURL(`${stagingDirectory}${path.sep}`);

  try {
    const results = [];
    for (const targetName of targetNames) {
      results.push(
        await packageTarget(targetName, {
          packageVersion,
          projectRootUrl,
          outputRootUrl,
          stagingRootUrl: stagingRunUrl,
        })
      );
    }
    return results;
  } finally {
    await rm(stagingRunUrl, { recursive: true, force: true });
  }
}

async function main() {
  const results = await packageStoreTargets(process.argv[2] || "stores");
  for (const result of results) {
    console.log(`${result.label}: ${result.zip}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
