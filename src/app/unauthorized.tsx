import { ErrorScreen } from "@/features/errors/ErrorScreen";
import { ERROR_PRESETS } from "@/features/errors/presets";
import { ButtonLink } from "@/shared/ui/ButtonLink";

/** Rendered with status 401 when a page calls `unauthorized()`. */
export default function Unauthorized() {
  return (
    <ErrorScreen
      preset={ERROR_PRESETS["401"]}
      actions={
        <ButtonLink href="/" variant="primary" icon="key">
          Sign in
        </ButtonLink>
      }
    />
  );
}
