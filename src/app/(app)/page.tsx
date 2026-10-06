import { LastUploadCard } from "@/features/home/LastUploadCard";
import { UploadCard } from "@/features/home/UploadCard";
import { Logo } from "@/shared/ui/Display";

/** Home: hero, upload card and the link to the last upload (design). */
export default function HomePage() {
  return (
    <>
      <section className="flex flex-col items-center gap-3.5 px-2 pt-7 pb-5 text-center">
        <Logo size={64} />
        <span className="text-[34px] font-bold tracking-[-0.01em]">RelayFiles</span>
        <p className="m-0 max-w-[520px] text-[16px] leading-[1.55] text-pretty text-t3">
          Private file drop for sharing and streaming media from my own server. Upload, get a link, and let it expire on a date or after a set number of downloads.
        </p>
      </section>
      <UploadCard />
      <LastUploadCard />
    </>
  );
}
