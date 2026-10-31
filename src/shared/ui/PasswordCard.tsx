"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError } from "@/shared/lib/api-client";
import { Button } from "./Button";
import { Icon } from "./icon/Icon";
import { StateCard } from "./StateCard";

interface PasswordCardProps {
  title: string;
  description: string;
  /** Checks the password on the server (which remembers it in a cookie); throws when it is wrong. */
  onUnlock: (password: string) => Promise<unknown>;
}

/** Password form of a protected public link; a right password reloads the page unlocked. */
export function PasswordCard({ title, description, onUnlock }: PasswordCardProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      await onUnlock(password);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Something went wrong.");
      setBusy(false);
    }
  };
  return (
    <StateCard icon="lock-simple" iconBox="bg-warn-bg-soft" iconColor="text-warn-strong" title={title} gap="gap-3.5">
      <p className="m-0 text-[14px] text-t3">{description}</p>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          type="password"
          aria-label="Password"
          placeholder="Password"
          value={password}
          autoComplete="off"
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
          className="box-border h-11 w-full rounded-[10px] border border-ctrl bg-bg px-3.5 text-[15px] text-t1 outline-none"
        />
        {error && (
          <span role="alert" className="flex items-center gap-1.5 self-start text-[13px] text-danger-text">
            <Icon name="warning-circle" />
            {error}
          </span>
        )}
        <Button type="submit" variant="primary" size={44} disabled={busy} className="w-full justify-center border-0">
          Unlock
        </Button>
      </form>
    </StateCard>
  );
}
