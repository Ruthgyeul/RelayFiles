"use client";

import { ErrorScreen } from "@/features/errors/ErrorScreen";
import { ERROR_PRESETS } from "@/features/errors/presets";
import { Button } from "@/shared/ui/Button";
import { ButtonLink } from "@/shared/ui/ButtonLink";

/** Unexpected error in a page. The digest matches the server log entry; no details are shown. */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ErrorScreen
      preset={ERROR_PRESETS["500"]}
      reference={error.digest}
      actions={
        <>
          <Button variant="primary" size={40} icon="arrows-clockwise" hoverable onClick={() => retry()}>
            Try again
          </Button>
          <ButtonLink href="/" icon="house">
            Go home
          </ButtonLink>
        </>
      }
    />
  );
}
