import { ErrorScreen } from "@/features/errors/ErrorScreen";
import { ERROR_PRESETS } from "@/features/errors/presets";
import { ButtonLink } from "@/shared/ui/ButtonLink";

export default function NotFound() {
  return (
    <ErrorScreen
      preset={ERROR_PRESETS["404"]}
      actions={
        <ButtonLink href="/" variant="primary" icon="house">
          Go home
        </ButtonLink>
      }
    />
  );
}
