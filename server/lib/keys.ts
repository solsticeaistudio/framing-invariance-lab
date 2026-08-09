import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type SigningKeyPair = {
  keyId: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
};

export function publicKeyFingerprint(publicKey: KeyObject | string): string {
  const key =
    typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
  const der = key.export({ type: "spki", format: "der" });
  return `ed25519:${createHash("sha256").update(der).digest("hex")}`;
}

export function generateSigningKeyPair(): SigningKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { keyId: publicKeyFingerprint(publicKey), publicKey, privateKey };
}

export function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ type: "spki", format: "pem" }).toString();
}

export function exportPrivateKey(privateKey: KeyObject): string {
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

export function writeSigningKeyPair(
  directory: string,
  name: string,
  pair: SigningKeyPair,
): { publicKeyPath: string; privateKeyPath: string } {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const publicKeyPath = path.resolve(directory, `${name}.public.pem`);
  const privateKeyPath = path.resolve(directory, `${name}.private.pem`);
  writeFileSync(publicKeyPath, exportPublicKey(pair.publicKey), {
    encoding: "utf8",
    mode: 0o644,
    flag: "wx",
  });
  writeFileSync(privateKeyPath, exportPrivateKey(pair.privateKey), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return { publicKeyPath, privateKeyPath };
}

export function loadPrivateSigningKey(file: string): KeyObject {
  return createPrivateKey(readFileSync(path.resolve(file), "utf8"));
}

export function loadPublicSigningKey(file: string): KeyObject {
  return createPublicKey(readFileSync(path.resolve(file), "utf8"));
}
