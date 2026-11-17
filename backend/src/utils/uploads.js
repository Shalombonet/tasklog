// This file checks, stores, locates, and removes private note image uploads.
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const backendRoot = path.resolve(__dirname, "../..");
const uploadsDirectory = path.join(backendRoot, "uploads");

// Detects supported image formats from their file signatures, not browser claims.
function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length >= pngSignature.length && buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { extension: "webp", mimeType: "image/webp" };
  }
  return null;
}

// Resolves a database upload path only when it stays inside backend/uploads.
function resolveUploadPath(filePath) {
  const absolutePath = path.resolve(backendRoot, filePath);
  const relativePath = path.relative(uploadsDirectory, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid stored upload path.");
  }
  return absolutePath;
}

// Removes one stored image and safely ignores files already missing from disk.
async function deleteUploadFile(filePath) {
  const absolutePath = resolveUploadPath(filePath);
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

// Removes a list of stored images one by one.
async function deleteUploadFiles(filePaths) {
  for (const filePath of filePaths) await deleteUploadFile(filePath);
}

// Saves verified images with random disk names and returns safe database values.
async function saveUploadedImages(files) {
  const verifiedFiles = files.map(function (file) {
    const imageType = detectImageType(file.buffer);
    if (!imageType) {
      const error = new Error("Only valid JPEG, PNG, or WebP images are allowed.");
      error.code = "INVALID_IMAGE_TYPE";
      throw error;
    }
    return { file: file, imageType: imageType };
  });

  await fs.mkdir(uploadsDirectory, { recursive: true });
  const savedFiles = [];
  try {
    for (const item of verifiedFiles) {
      const diskName = crypto.randomUUID() + "." + item.imageType.extension;
      const diskPath = path.join(uploadsDirectory, diskName);
      await fs.writeFile(diskPath, item.file.buffer, { flag: "wx" });
      const originalName = path.basename(String(item.file.originalname || "image").replace(/\\/g, "/"))
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 255) || "image";
      savedFiles.push({ fileName: originalName, filePath: "uploads/" + diskName });
    }
    return savedFiles;
  } catch (error) {
    await Promise.allSettled(savedFiles.map(function (item) { return deleteUploadFile(item.filePath); }));
    throw error;
  }
}

// Returns the safe upload location and image type used by the private download route.
function getUploadDetails(filePath) {
  const absolutePath = resolveUploadPath(filePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType = extension === ".jpg" ? "image/jpeg" : extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : null;
  if (!mimeType) throw new Error("Invalid stored image type.");
  return { absolutePath: absolutePath, mimeType: mimeType };
}

module.exports = { uploadsDirectory, detectImageType, saveUploadedImages, getUploadDetails, deleteUploadFile, deleteUploadFiles };
