import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export function artifactHash(directory) {
  function files(relative = '') { return readdirSync(join(directory, relative), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(relative, entry.name)) : [join(relative, entry.name)]); }
  const digest = createHash('sha256');
  for (const relative of files().sort()) { digest.update(relative.replaceAll('\\', '/') + '\0'); digest.update(readFileSync(join(directory, relative))); digest.update('\0'); }
  return digest.digest('hex');
}
