import { createECDH, randomBytes } from "node:crypto";
import ece from "http_ece";
import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, encryptPayload, vapidAuthorization } from "../src/push";

describe("web push", () => {
  it("cifra in modo decifrabile dal browser (RFC 8291)", async () => {
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const auth = randomBytes(16);
    const sub = {
      endpoint: "https://web.push.apple.com/abc",
      p256dh: b64urlEncode(browser.getPublicKey()),
      auth: b64urlEncode(auth),
    };
    const body = await encryptPayload(sub, JSON.stringify({ title: "Ciao", body: "àèì" }));
    const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: browser, authSecret: auth });
    expect(JSON.parse(plain.toString("utf8"))).toEqual({ title: "Ciao", body: "àèì" });
  });

  it("firma il JWT VAPID con una firma ES256 verificabile", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const header = await vapidAuthorization("https://web.push.apple.com/abc", {
      publicKey: b64urlEncode(raw),
      privateKey: jwk.d!,
      subject: "mailto:test@example.com",
    });
    const [, token, k] = /^vapid t=(.+), k=(.+)$/.exec(header)!;
    expect(k).toBe(b64urlEncode(raw));
    const [h, c, s] = token.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c))).aud).toBe("https://web.push.apple.com");
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });
});
