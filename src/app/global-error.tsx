"use client";

import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@/shared/styles/globals.css";
import { DEFAULT_THEME } from "@/config/theme";
import { ErrorScreen } from "@/features/errors/ErrorScreen";
import { ERROR_PRESETS } from "@/features/errors/presets";
import { Button } from "@/shared/ui/Button";

/**
 * Replaces the root layout when it fails. It renders its own document, so it applies the
 * design's default theme itself (the server-selected theme is not available here).
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME}>
      <body>
        <title>Something went wrong · RelayFiles</title>
        <ErrorScreen
          preset={ERROR_PRESETS["500"]}
          reference={error.digest}
          actions={
            <Button variant="primary" size={40} icon="arrows-clockwise" hoverable onClick={() => retry()}>
              Try again
            </Button>
          }
        />
      </body>
    </html>
  );
}
