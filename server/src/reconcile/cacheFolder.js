// A custom cache path the operator typed is handed to Docker as a bind-mount
// source. If the folder does not exist, the daemon creates it as root:root and
// the instance (running as PUID:PGID) cannot write to it. Before the instance
// starts, a one-shot helper container chowns it, but only when it is empty and
// still owned by 0:0 — never a folder that has data or another owner, never
// recursively. The helper has no managed labels, so plans never see it.

import { createContainer, startContainer, waitContainer, removeContainer } from "../docker/client.js";
import { ownership as realOwnership } from "../store/paths.js";
import { customCachePath, instanceContainerName, instanceImage } from "./instance.js";

// Exit 10 means "changed": the proxy does not grant container logs, so the
// exit code is the only channel back.
const script = ({ uid, gid }) =>
  `[ "$(stat -c %u:%g /cache)" = 0:0 ] && [ -z "$(ls -A /cache)" ] || exit 0\nchown ${uid}:${gid} /cache && exit 10`;

// Never throws: a helper that cannot run only costs the operator a warning.
export async function prepareCacheFolder(key, values, { log = () => {}, ownership = realOwnership() } = {}) {
  const cachePath = customCachePath(values);
  if (!cachePath || !ownership || (ownership.uid === 0 && ownership.gid === 0)) return;

  const name = `${instanceContainerName(key, values)}-cache-init`;
  try {
    await removeContainer(name, { force: true });
    await createContainer(name, {
      Image: instanceImage(values),
      User: "0:0",
      Entrypoint: ["sh", "-c"],
      Cmd: [script(ownership)],
      HostConfig: { Binds: [`${cachePath}:/cache`] },
    });
    await startContainer(name);
    const code = await waitContainer(name);
    if (code === 10) log(`Gave the new cache folder ${cachePath} to ${ownership.uid}:${ownership.gid}.`);
    else if (code !== 0) throw new Error(`exited with code ${code}`);
  } catch (err) {
    log(`Warning: could not prepare the cache folder ${cachePath}: ${err.message}`);
  } finally {
    await removeContainer(name, { force: true }).catch(() => {});
  }
}
