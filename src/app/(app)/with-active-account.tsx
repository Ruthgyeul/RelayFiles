import type { ReactNode } from "react";
import { nodeIdSchema } from "@/contracts/nodes";
import { currentDevice } from "@/server/auth/current";
import type { DeviceAccount } from "@/server/auth/device-session";
import Loading from "./loading";

/** The `?view=` file to open in the viewer right away (global search), when it is a node id. */
export function initialViewOf(param: string | string[] | undefined): string | undefined {
  return typeof param === "string" && nodeIdSchema.safeParse(param).success ? param : undefined;
}

/**
 * Renders a page for the active account. A first visit has no account yet: the shell creates
 * one and refreshes the page, which shows the loading state until then.
 */
export async function withActiveAccount(render: (active: DeviceAccount) => ReactNode | Promise<ReactNode>): Promise<ReactNode> {
  const device = await currentDevice();
  if (!device.active) return <Loading />;
  return render(device.active);
}
