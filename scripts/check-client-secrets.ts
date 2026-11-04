import { readdir, readFile } from 'node:fs/promises';
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const groups = await Promise.all(entries.map(e => e.isDirectory() ? files(`${dir}/${e.name}`) : Promise.resolve([`${dir}/${e.name}`])));
  return groups.flat();
}
const paths = await files('dist/web');
for (const path of paths) {
  const contents = await readFile(path, 'utf8');
  for (const field of ['TATUM_API_KEY', 'WALRUS_MEMORY_DELEGATE_SECRET']) {
    const value = process.env[field]?.trim();
    if (value && contents.includes(value)) throw new Error(`Secret detected in client artifact: ${field}`);
  }
}
console.log('Client artifact scan passed: configured provider/delegate secrets absent.');
