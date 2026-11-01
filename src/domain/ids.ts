/**
 * Identifier formats from the design.
 * Generation uses Web Crypto (available in browsers and Node) with rejection sampling,
 * so every character is uniformly distributed (the prototype's modulo had a small bias).
 */

/** Lowercase base32 without look-alike characters (no i, l, o, 0, 1). */
export const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
/** Mixed-case token alphabet without look-alikes. */
export const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/** Upper-case invite code alphabet. */
export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const ID_LENGTH = { account: 12, node: 12, link: 10, token: 40, session: 32, anonSuffix: 6, inviteGroup: 4, apiToken: 43, apiTokenId: 12, fileRequest: 12, deletedItem: 12 } as const;

/**
 * Personal API tokens are `rfp_<token id>_<43 random characters>`: the prefix tells them apart
 * from account tokens (and lets secret scanners find them), the id finds the row to check.
 */
export const API_TOKEN_PREFIX = "rfp_";

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
  session: pattern(ID_LENGTH.session, ID_ALPHABET),
  apiToken: new RegExp(`^${API_TOKEN_PREFIX}([${ID_ALPHABET}]{${ID_LENGTH.apiTokenId}})_[${TOKEN_ALPHABET}]{${ID_LENGTH.apiToken}}$`),
  apiTokenId: pattern(ID_LENGTH.apiTokenId, ID_ALPHABET),
  fileRequest: pattern(ID_LENGTH.fileRequest, ID_ALPHABET),
  deletedItem: pattern(ID_LENGTH.deletedItem, ID_ALPHABET),
  anonName: new RegExp(`^anon-[${ID_ALPHABET}]{${ID_LENGTH.anonSuffix}}$`),
  invite: new RegExp(`^[${INVITE_ALPHABET}]{4}-[${INVITE_ALPHABET}]{4}$`),
  /** Request ids (x-request-id) are UUIDs; anything else a client sends is replaced. */
  requestId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

/** The incoming request id when it is a UUID (logs and error pages must not echo arbitrary text), else null. */
export const validRequestId = (value: string | null): string | null => (value !== null && ID_PATTERN.requestId.test(value) ? value : null);

export const newAccountId = () => randomString(ID_LENGTH.account, ID_ALPHABET);
export const newNodeId = () => randomString(ID_LENGTH.node, ID_ALPHABET);
export const newLinkId = () => randomString(ID_LENGTH.link, ID_ALPHABET);
export const newAccountToken = () => randomString(ID_LENGTH.token, TOKEN_ALPHABET);
export const newSessionId = () => randomString(ID_LENGTH.session, ID_ALPHABET);
export const newAnonName = () => `anon-${randomString(ID_LENGTH.anonSuffix, ID_ALPHABET)}`;
export const newApiToken = (id: string) => `${API_TOKEN_PREFIX}${id}_${randomString(ID_LENGTH.apiToken, TOKEN_ALPHABET)}`;
export const newApiTokenId = () => randomString(ID_LENGTH.apiTokenId, ID_ALPHABET);
export const newFileRequestId = () => randomString(ID_LENGTH.fileRequest, ID_ALPHABET);
export const newDeletedItemId = () => randomString(ID_LENGTH.deletedItem, ID_ALPHABET);
export const newInviteCode = () => `${randomString(ID_LENGTH.inviteGroup, INVITE_ALPHABET)}-${randomString(ID_LENGTH.inviteGroup, INVITE_ALPHABET)}`;

export const isAccountId = (value: string) => ID_PATTERN.account.test(value);
