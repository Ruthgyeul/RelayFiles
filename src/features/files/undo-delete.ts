import type { NoticeAction } from "@/shared/hooks/useNotice";
import { errorMessage } from "@/shared/lib/api-client";
import { trashApi } from "@/shared/lib/trash-api";

/**
 * "Undo" for the notice after a delete: restores the "Recently deleted" entries the delete
 * made (none when it was not recoverable, then there is no Undo).
 */
export function undoDelete(trashIds: readonly string[], { notify, done }: { notify: (message: string) => void; done: () => void }): NoticeAction | undefined {
  if (trashIds.length === 0) return undefined;
  return {
    label: "Undo",
    run: () =>
      void trashApi
        .bulk("restore", [...trashIds])
        .then(({ restored }) => {
          notify(restored.length === 1 ? "Restored" : `${restored.length} items restored`);
          done();
        })
        .catch((caught: unknown) => notify(errorMessage(caught))),
  };
}
