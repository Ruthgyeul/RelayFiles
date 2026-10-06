import { ErrorScreen } from "@/features/errors/ErrorScreen";
import { ERROR_PRESETS } from "@/features/errors/presets";
import { ButtonLink } from "@/shared/ui/ButtonLink";

/** Rendered with status 403 when a page calls `forbidden()` (e.g. admin pages for members). */
export default function Forbidden() {
  return (
    <ErrorScreen
      preset={ERROR_PRESETS["403"]}
      actions={
        <ButtonLink href="/" variant="primary" icon="house">
          Go home
        </ButtonLink>
      }
    />
  );
}
