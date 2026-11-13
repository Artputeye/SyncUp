import { BadRequestException } from "@nestjs/common";
import { constants } from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import * as path from "node:path";

function resolveKey(root: string, key: string, prefix: string[]) {
  const parts = key.split("/");
  if (!key || key.includes(String.fromCharCode(92)) || path.posix.isAbsolute(key) || path.win32.isAbsolute(key)
    || prefix.some((part, index) => parts[index] !== part)
    || parts.length <= prefix.length || parts.some((part) => !part || part === "." || part === "..")) {
    throw new BadRequestException("Invalid Workspace media storage key");
  }
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new BadRequestException("Media storage path escapes its root");
  }
  return { target, parts };
}

async function assertDirectory(directory: string, create: boolean) {
  if (create) await mkdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new BadRequestException("Media storage path contains a symbolic link or non-directory");
  }
}

async function assertRoot(root: string, create: boolean) {
  if (create) await mkdir(root, { recursive: true });
  await assertDirectory(root, false);
}

async function assertParents(root: string, parts: string[], create: boolean) {
  await assertRoot(root, create);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    await assertDirectory(current, create);
  }
}

export async function writeWorkspaceMediaFile(root: string, key: string, workspaceId: string, bytes: Buffer) {
  const { target, parts } = resolveKey(root, key, [workspaceId]);
  await assertParents(root, parts, true);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(target, flags, 0o640);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

export async function readWorkspaceMediaFile(root: string, key: string, workspaceId: string) {
  const { target, parts } = resolveKey(root, key, [workspaceId]);
  await assertParents(root, parts, false);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(target, flags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new BadRequestException("Media object is not a regular file");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function removeWorkspaceMediaFile(root: string, key: string, workspaceId: string) {
  const { target, parts } = resolveKey(root, key, [workspaceId]);
  await assertParents(root, parts, false);
  const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new BadRequestException("Refusing to remove non-file media object");
  await rm(target);
}

export async function removeWorkspaceMediaTree(root: string, key: string, workspaceId: string) {
  const { target, parts } = resolveKey(root, key, [workspaceId]);
  await assertParents(root, parts, false);
  const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new BadRequestException("Refusing to remove non-directory media tree");
  await rm(target, { recursive: true, force: true });
}

export async function writeWorkspaceStagingFile(root: string, key: string, workspaceId: string, bytes: Buffer) {
  const { target, parts } = resolveKey(root, key, ["staging", workspaceId]);
  await assertParents(root, parts, true);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(target, flags, 0o640);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

export async function readWorkspaceStagingFile(root: string, key: string, workspaceId: string) {
  const { target, parts } = resolveKey(root, key, ["staging", workspaceId]);
  await assertParents(root, parts, false);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(target, flags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new BadRequestException("Staging object is not a regular file");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function removeWorkspaceStagingFile(root: string, key: string, workspaceId: string) {
  const { target, parts } = resolveKey(root, key, ["staging", workspaceId]);
  await assertParents(root, parts, false);
  const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new BadRequestException("Refusing to remove non-file staging object");
  await rm(target);
}

export async function removeWorkspaceStagingTree(root: string, key: string, workspaceId: string) {
  const { target, parts } = resolveKey(root, key, ["staging", workspaceId]);
  await assertParents(root, parts, false);
  const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new BadRequestException("Refusing to remove non-directory staging tree");
  await rm(target, { recursive: true, force: true });
}
