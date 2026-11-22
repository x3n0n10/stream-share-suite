// A custom cache path the operator typed is handed to Docker as a bind-mount
// source. If the folder does not exist, the daemon creates it as root:root and
// the instance (running as PUID:PGID) cannot write to it. Before the instance
// starts, a one-shot helper container chowns it, but only when it is empty and
// still owned by 0:0 — never a folder that has data or another owner, never
// recursively. The helper has no managed labels, so plans never see it.

import { createContainer, startContainer, waitContainer, removeContainer, inspectContainer } from "../docker/client.js";
import { ownership as realOwnership } from "../store/paths.js";
import { customCachePath, instanceContainerName, instanceImage } from "./instance.js";

// Not one of the managed labels, so plans never see the helper; it only marks
// a leftover as ours, so a foreign container of the same name is never removed.
const HELPER_LABEL = "streamshare.suite.cache-init";

// Exit 10 means "changed": the proxy does not grant container logs, so the
// exit code is the only channel back.
const script = ({ uid, gid }) =>
  `[ "$(stat -c %u:%g /cache)" = 0:0 ] && [ -z "$(ls -A /cache)" ] || exit 0\nchown ${uid}:${gid} /cache && exit 10`;

// Never throws: a helper that cannot run only costs the operator a warning.
export async function prepareCacheFolder(key, values, { log = () => {}, ownership = realOwnership() } = {}) {
  const cachePath = customCachePath(values);
  if (!cachePath || !ownership || (ownership.uid === 0 && ownership.gid === 0)) return;

  const name = `${instanceContainerName(key, values)}-cache-init`;
  let created = false;
  try {
    const leftover = await inspectContainer(name);
    if (leftover) {
      if (leftover.Config?.Labels?.[HELPER_LABEL] !== "true") {
        throw new Error(`a container named ${name} already exists and is not a cache helper`);
      }
      await removeContainer(name, { force: true });
    }
    created = true;
    await createContainer(name, {
      Labels: { [HELPER_LABEL]: "true" },
      Image: instanceImage(values),
      User: "0:0",
      Entrypoint: ["sh", "-c"],
      Cmd: [script(ownership)],
      HostConfig: { Binds: [`${cachePath}:/cache`], NetworkMode: "none" },
    });
    await startContainer(name);
    const code = await waitContainer(name);
    if (code === 10) log(`Gave the new cache folder ${cachePath} to ${ownership.uid}:${ownership.gid}.`);
    else if (code !== 0) throw new Error(`exited with code ${code}`);
  } catch (err) {
    log(`Warning: could not prepare the cache folder ${cachePath}: ${err.message}`);
  } finally {
    if (created) await removeContainer(name, { force: true }).catch(() => {});
  }
}
