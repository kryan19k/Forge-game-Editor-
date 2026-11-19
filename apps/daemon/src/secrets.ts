import { existsSync, readFileSync, writeFileSync } from 'node:fs';

type Keys = { anthropicApiKey?: string; tripoApiKey?: string };

function readKeys(file: string): Keys {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Keys : {};
}

export function readKey(file: string, name: keyof Keys): string | null {
  try {
    const key = readKeys(file)[name];
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}

export function storeKey(file: string, name: keyof Keys, value: string | null): void {
  const keys = readKeys(file);
  if (value) keys[name] = value;
  else delete keys[name];
  writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
}
