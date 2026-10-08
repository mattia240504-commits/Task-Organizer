// Genera le chiavi VAPID per le notifiche push: `npm run vapid`
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);

console.log(`VAPID_PUBLIC_KEY=${raw.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${priv.d}`);
