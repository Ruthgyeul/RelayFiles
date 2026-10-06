import { ErrorScreen } from "@/features/errors/ErrorScreen";
import { LINK_NOT_FOUND } from "@/features/errors/presets";

export default function LinkNotFound() {
  return <ErrorScreen preset={LINK_NOT_FOUND} />;
}
