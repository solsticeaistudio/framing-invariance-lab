import { readFile, writeFile } from "node:fs/promises";

export function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function required(name: string): string {
  const value = option(name)?.trim();
  if (!value) throw new Error(`Missing required --${name} option.`);
  return value;
}

export function list(name: string): string[] {
  return required(name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function jsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}
