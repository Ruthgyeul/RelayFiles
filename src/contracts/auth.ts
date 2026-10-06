import { z } from "zod";

/** Sign-up modes an admin can choose on the Server page (design `suOpts`). */
export const SIGNUP_MODES = ["open", "invite", "closed"] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

/** An account signed in on this device, as shown in the sidebar account list. */
export interface SessionAccount {
  id: string;
  name: string;
  color: string;
  isAdmin: boolean;
  neverExpire: boolean;
  /** ISO date the account is deleted with its files; null when it never expires. */
  deletesAt: string | null;
  /** Storage quota in bytes as a decimal string (BigInt-safe); null = unlimited. */
  quotaBytes: string | null;
}

/** Storage use of the active account (sidebar meter, quota banners, account switch toast). */
export interface AccountUsage {
  /** Bytes as a decimal string (BigInt-safe). */
  usedBytes: string;
  /** Items directly in the root folder. */
  rootItems: number;
}

/** Accounts signed in on this device and which one is active. */
export interface SessionState {
  accounts: SessionAccount[];
  activeAccountId: string | null;
  signupMode: SignupMode;
  /** Usage of the active account; null when nobody is signed in. */
  usage: AccountUsage | null;
}

/** Response of account creation: the token is returned exactly once here. */
export interface CreatedAccount {
  account: SessionAccount;
  token: string;
  session: SessionState;
}

/** Upper bound for pasted input; real tokens are 40 characters. */
const MAX_TOKEN_INPUT = 200;

export const tokenSignInSchema = z.object({
  token: z.string().trim().max(MAX_TOKEN_INPUT),
});

export const createAccountSchema = z.object({
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(32)
    .optional()
    .transform((value) => value || undefined),
});

export const accountRefSchema = z.object({
  accountId: z.string().min(1).max(32),
});

export const tokenQuerySchema = z.object({
  /** Account signed in on this device whose token to reveal; defaults to the active account. */
  accountId: z.string().min(1).max(32).optional(),
});

export const signOutSchema = z.object({
  /** Account to sign out on this device; defaults to the active account. */
  accountId: z.string().min(1).max(32).optional(),
});

export type TokenSignIn = z.infer<typeof tokenSignInSchema>;
export type CreateAccount = z.infer<typeof createAccountSchema>;
