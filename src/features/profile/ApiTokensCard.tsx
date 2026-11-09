"use client";

import { useState } from "react";
import type { ApiTokenDto, CreateApiTokenInput, CreatedApiToken } from "@/contracts/api-tokens";
import { tokenHealth, tokenHealthText, type TokenUse } from "@/domain/api-token";
import { formatDateTime, formatLongDate, formatSeen } from "@/domain/format";
import { ApiClientError } from "@/shared/lib/api-client";
import { useMounted } from "@/shared/hooks/useMounted";
import { useNow } from "@/shared/hooks/useNow";
import { Button } from "@/shared/ui/Button";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { Icon } from "@/shared/ui/icon/Icon";
import { profileApi } from "./api";
import { CreateApiTokenDialog } from "./CreateApiTokenDialog";
import { SectionTitle } from "./Section";

/** Re-render interval for "used 12m ago". */
const SEEN_TICK_MS = 60_000;

interface ApiTokensCardProps {
  tokens: ApiTokenDto[];
  isAdmin: boolean;
  notify: (message: string) => void;
  /** Re-renders the page with fresh server data. */
  refresh: () => void;
}

const timesOf = (token: ApiTokenDto): TokenUse => ({
  createdAt: Date.parse(token.createdAt),
  lastUsedAt: token.lastUsedAt ? Date.parse(token.lastUsedAt) : null,
  expiresAt: token.expiresAt ? Date.parse(token.expiresAt) : null,
});

/**
 * One token: name, scopes, expiry and last use (exact times in the tooltip), and a warning
 * when it expires soon or nobody uses it. `now` is null until mounted, so the server render
 * shows no relative times or warnings that the browser clock might contradict.
 */
function TokenRow({ token, now, busy, onRevoke }: { token: ApiTokenDto; now: number | null; busy: boolean; onRevoke: () => void }) {
  const health = now === null ? "ok" : tokenHealth(timesOf(token), now);
  const warning = tokenHealthText(health);
  const unusedHint = health === "stale" || health === "unused" ? " Revoke it if nothing needs it." : "";
  const lastUse = token.lastUsedAt ? (now === null ? "" : `used ${formatSeen(Date.parse(token.lastUsedAt), now)}`) : "never used";
  const exact = [`Created ${formatDateTime(token.createdAt)}`, token.lastUsedAt && `Last used ${formatDateTime(token.lastUsedAt)}`, token.expiresAt && `Expires ${formatDateTime(token.expiresAt)}`]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="flex items-center gap-3 border-t border-card-line py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-btn">
        <Icon name="key" size={18} className="text-t2" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-bold">{token.name}</span>
          {warning && (
            <span title={`${warning}.${unusedHint}`} className="shrink-0 rounded-md bg-warn-bg-soft px-1.5 py-0.5 text-[11px] font-bold text-warn-text">
              {warning}
            </span>
          )}
        </span>
        <span className="truncate font-mono text-[12px] text-t4">{token.scopes.join(" · ")}</span>
        <span title={exact} className="truncate text-[12px] text-t4">
          {token.expiresAt ? `Expires ${formatLongDate(token.expiresAt)}` : "Never expires"} · {lastUse}
        </span>
      </div>
      <Button size={32} variant="danger-outline" disabled={busy} onClick={onRevoke}>
        Revoke
      </Button>
    </div>
  );
}

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");

/** "API tokens": personal tokens for scripts and apps (/api/v1), with create and revoke. */
export function ApiTokensCard({ tokens, isAdmin, notify, refresh }: ApiTokensCardProps) {
  const now = useNow(true, SEEN_TICK_MS);
  const mounted = useMounted();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [revoking, setRevoking] = useState<ApiTokenDto | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (input: CreateApiTokenInput) => {
    setBusy(true);
    try {
      setCreated(await profileApi.createApiToken(input));
      refresh();
    } catch (caught) {
      notify(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ApiTokenDto) => {
    setBusy(true);
    try {
      await profileApi.revokeApiToken(token.id);
      notify(`Revoked ${token.name}`);
      refresh();
    } catch (caught) {
      notify(errorText(caught));
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  };

  const closeCreate = () => {
    setCreating(false);
    setCreated(null);
  };

  const copy = async (token: string) => {
    await navigator.clipboard?.writeText(token).catch(() => undefined);
    notify("API token copied");
  };

  return (
    <section aria-label="API tokens" className="flex flex-col gap-1 rounded-2xl border border-card-line bg-card p-5">
      <div className="mb-2">
        <SectionTitle
          icon="plugs"
          box="bg-accent-soft"
          color="text-accent-icon"
          after={
            <Button size={34} icon="plus" onClick={() => setCreating(true)} className="px-3">
              New token
            </Button>
          }
        >
          <div className="flex min-w-[160px] flex-1 flex-col gap-0.5">
            <h2 className="m-0 text-[17px] font-bold">API tokens</h2>
            <span className="text-[12px] text-t4">For scripts and apps such as ShareX or curl (/api/v1)</span>
          </div>
        </SectionTitle>
      </div>
      {tokens.length === 0 && <span className="border-t border-card-line py-3 text-[13px] text-t4">No API tokens yet.</span>}
      {tokens.map((token) => (
        <TokenRow key={token.id} token={token} now={mounted ? now : null} busy={busy} onRevoke={() => setRevoking(token)} />
      ))}

      {creating && <CreateApiTokenDialog isAdmin={isAdmin} busy={busy} created={created} onCreate={(input) => void create(input)} onCopy={(token) => void copy(token)} onClose={closeCreate} />}
      <ConfirmDialog
        open={revoking !== null}
        icon="trash"
        title={`Revoke ${revoking?.name ?? "this token"}?`}
        description="Apps using it stop working immediately."
        confirmLabel="Revoke"
        busy={busy}
        onConfirm={() => revoking && void revoke(revoking)}
        onCancel={() => setRevoking(null)}
      />
    </section>
  );
}
