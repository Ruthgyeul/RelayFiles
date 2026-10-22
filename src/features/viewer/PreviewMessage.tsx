import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";

/** Centered state of a preview stage: loading, failed, or nothing to show for this file. */
export function PreviewMessage({ icon, iconColor, spin, children, action }: { icon: IconName; iconColor?: string; spin?: boolean; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center text-t4">
      <Icon name={icon} size={spin ? 32 : 56} className={cn(spin && "animate-spin")} style={iconColor ? { color: iconColor } : undefined} />
      {children}
      {action}
    </div>
  );
}

export const LoadingPreview = () => (
  <PreviewMessage icon="circle-notch" spin>
    Loading preview
  </PreviewMessage>
);

export const FailedPreview = () => <PreviewMessage icon="warning-circle">Preview failed to load</PreviewMessage>;
