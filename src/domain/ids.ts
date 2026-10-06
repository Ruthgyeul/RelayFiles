/**
 * Identifier formats from the design prototype (`newAcct`, `regenLink`, `genInvite`).
 * Generation uses Web Crypto (available in browsers and Node) with rejection sampling,
 * so every character is uniformly distributed (the prototype's modulo had a small bias).
 */

/** Lowercase base32 without look-alike characters (no i, l, o, 0, 1). */
export const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
/** Mixed-case token alphabet without look-alikes. */
export const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/** Upper-case invite code alphabet. */
export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const ID_LENGTH = { account: 12, node: 12, link: 10, token: 40, anonSuffix: 6, inviteGroup: 4 } as const;

type RandomSource = (bytes: Uint8Array) => Uint8Array;
const webRandom: RandomSource = (bytes) => crypto.getRandomValues(bytes);

/** Random string of `length` characters drawn uniformly from `alphabet`. */
export function randomString(length: number, alphabet: string, random: RandomSource = webRandom): string {
  if (alphabet.length < 2 || alphabet.length > 256) throw new RangeError("alphabet must have 2–256 characters");
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of random(new Uint8Array(length * 2))) {
      if (byte < limit) out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

const pattern = (length: number, alphabet: string) => new RegExp(`^[${alphabet}]{${length}}$`);

export const ID_PATTERN = {
  account: pattern(ID_LENGTH.account, ID_ALPHABET),
  node: pattern(ID_LENGTH.node, ID_ALPHABET),
  link: pattern(ID_LENGTH.link, ID_ALPHABET),
  token: pattern(ID_LENGTH.token, TOKEN_ALPHABET),
  anonName: new RegExp(`^anon-[${ID_ALPHABET}]{${ID_LENGTH.anonSuffix}}$`),
  invite: new RegExp(`^[${INVITE_ALPHABET}]{4}-[${INVITE_ALPHABET}]{4}$`),
} as const;

export const newAccountId = () => randomString(ID_LENGTH.account, ID_ALPHABET);
export const newNodeId = () => randomString(ID_LENGTH.node, ID_ALPHABET);
export const newLinkId = () => randomString(ID_LENGTH.link, ID_ALPHABET);
export const newAccountToken = () => randomString(ID_LENGTH.token, TOKEN_ALPHABET);
export const newAnonName = () => `anon-${randomString(ID_LENGTH.anonSuffix, ID_ALPHABET)}`;
export const newInviteCode = () => `${randomString(ID_LENGTH.inviteGroup, INVITE_ALPHABET)}-${randomString(ID_LENGTH.inviteGroup, INVITE_ALPHABET)}`;

export const isAccountId = (value: string) => ID_PATTERN.account.test(value);
export const isNodeId = (value: string) => ID_PATTERN.node.test(value);
export const isLinkId = (value: string) => ID_PATTERN.link.test(value);
