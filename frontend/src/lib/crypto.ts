/* Client-side AES-GCM envelope for the seed phrase.
 *
 * The agent in the TEE decrypts this envelope inside the enclave. Sending the
 * symmetric key alongside the ciphertext is acceptable here because the entire
 * channel is TLS-terminated *inside* the enclave — no host-side intermediary
 * sees the plaintext. Production would substitute ECIES against the agent's
 * attested public key. */

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

export interface Envelope {
  encryption_key: string;
  encryption_iv: string;
  encrypted_seed: string;
}

export async function encryptSeed(seedPhrase: string): Promise<Envelope> {
  const aesKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(seedPhrase);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    aesKey,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoded,
  );

  return {
    encryption_key: toB64(aesKey),
    encryption_iv: toB64(iv),
    encrypted_seed: toB64(ciphertext),
  };
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
