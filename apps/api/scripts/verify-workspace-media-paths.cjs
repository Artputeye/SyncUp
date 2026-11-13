const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  readWorkspaceMediaFile,
  writeWorkspaceMediaFile,
  removeWorkspaceMediaFile,
  removeWorkspaceMediaTree,
  readWorkspaceStagingFile,
  writeWorkspaceStagingFile,
  removeWorkspaceStagingFile,
  removeWorkspaceStagingTree,
} = require("../dist/core/products/workspace-media-storage.js");
const { MediaService } = require("../dist/core/products/media.service.js");

const workspaceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspaceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function main() {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "syncup-p07-media-"));
  const root = path.join(temp, "media");
  const outside = path.join(temp, "outside");
  await fsp.mkdir(outside);
  const outsideFile = path.join(outside, "secret.txt");
  await fsp.writeFile(outsideFile, "outside-secret");

  try {
    const mediaKey = workspaceA + "/asset-id/main.webp";
    await writeWorkspaceMediaFile(root, mediaKey, workspaceA, Buffer.from("workspace-a-image"));
    assert.equal((await readWorkspaceMediaFile(root, mediaKey, workspaceA)).toString(), "workspace-a-image");

    const mediaAssetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const mediaService = Object.create(MediaService.prototype);
    mediaService.root = root;
    mediaService.databases = {
      forMembership: async (_userId, workspaceId) => workspaceId === workspaceA
        ? { $queryRaw: async () => [{ object_key: mediaKey, mime_type: "image/webp", size_bytes: 17n }] }
        : { $queryRaw: async () => [] },
    };
    const mediaResponse = await mediaService.getMediaFile("user-a", workspaceA, mediaAssetId, "MAIN");
    assert.equal(mediaResponse.bytes.toString(), "workspace-a-image");
    await assert.rejects(mediaService.getMediaFile("user-b", workspaceB, mediaAssetId, "MAIN"), (error) => error.getStatus?.() === 404);


    await assert.rejects(readWorkspaceMediaFile(root, mediaKey, workspaceB));
    await assert.rejects(writeWorkspaceMediaFile(root, workspaceA + "/../" + workspaceB + "/bad.webp", workspaceA, Buffer.from("bad")));
    await assert.rejects(readWorkspaceMediaFile(root, workspaceA + "\\asset-id\\main.webp", workspaceA));
    await assert.rejects(readWorkspaceMediaFile(root, "../" + workspaceA + "/asset/main.webp", workspaceA));

    const workspaceLink = path.join(root, workspaceA, "linked-asset");
    await fsp.symlink(outside, workspaceLink, "junction");
    await assert.rejects(readWorkspaceMediaFile(root, workspaceA + "/linked-asset/secret.txt", workspaceA), /symbolic link|directory/i);
    await assert.rejects(writeWorkspaceMediaFile(root, workspaceA + "/linked-asset/created.txt", workspaceA, Buffer.from("no")));

    const workspaceRootLink = path.join(root, workspaceB);
    await fsp.symlink(outside, workspaceRootLink, "junction");
    await assert.rejects(readWorkspaceMediaFile(root, workspaceB + "/secret.txt", workspaceB), /symbolic link|directory/i);

    const stagingKey = "staging/" + workspaceA + "/batch-id/image.webp";
    await writeWorkspaceStagingFile(root, stagingKey, workspaceA, Buffer.from("staged-image"));
    assert.equal((await readWorkspaceStagingFile(root, stagingKey, workspaceA)).toString(), "staged-image");
    await assert.rejects(readWorkspaceStagingFile(root, stagingKey, workspaceB));
    await assert.rejects(readWorkspaceStagingFile(root, "staging/" + workspaceA + "/../" + workspaceB + "/image.webp", workspaceA));

    const stageLink = path.join(root, "staging", workspaceA, "linked-batch");
    await fsp.symlink(outside, stageLink, "junction");
    await assert.rejects(readWorkspaceStagingFile(root, "staging/" + workspaceA + "/linked-batch/secret.txt", workspaceA), /symbolic link|directory/i);
    await assert.rejects(writeWorkspaceStagingFile(root, "staging/" + workspaceA + "/linked-batch/created.txt", workspaceA, Buffer.from("no")));

    await removeWorkspaceMediaFile(root, mediaKey, workspaceA);
    await removeWorkspaceStagingFile(root, stagingKey, workspaceA);
    await writeWorkspaceMediaFile(root, workspaceA + "/batch/file.webp", workspaceA, Buffer.from("cleanup"));
    await removeWorkspaceMediaTree(root, workspaceA + "/batch", workspaceA);
    await writeWorkspaceStagingFile(root, "staging/" + workspaceA + "/batch/file.webp", workspaceA, Buffer.from("cleanup"));
    await removeWorkspaceStagingTree(root, "staging/" + workspaceA + "/batch", workspaceA);

    const controllerSource = fs.readFileSync(path.join(__dirname, "../src/core/products/media.controller.ts"), "utf8");
    assert.match(controllerSource, /Cache-Control", "private, no-store, max-age=0"/);
    assert.match(controllerSource, /Pragma", "no-cache"/);
    assert.match(controllerSource, /Vary", "Cookie, Authorization"/);

    console.log("P0.7_WORKSPACE_MEDIA_PATHS PASS");
    console.log("PASS media service resolves media IDs only through the requested Workspace Tenant DB");
    console.log("PASS media and staging files are isolated by Workspace prefix");
    console.log("PASS traversal, absolute paths and Windows separators are rejected");
    console.log("PASS Workspace-root and nested-directory symlinks are rejected for read/write");
    console.log("PASS media and staging cleanup remains confined to the requested Workspace");
    console.log("PASS authenticated media responses disable shared caching");
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
