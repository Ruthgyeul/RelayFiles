import { Banner } from "@/shared/ui/Banner";
import { Button } from "@/shared/ui/Button";
import { Card, ListCard, ListRow } from "@/shared/ui/Card";
import { EmptyState, Kbd, Logo, Skeleton } from "@/shared/ui/Display";
import { Pill } from "@/shared/ui/Pill";
import { Tag } from "@/shared/ui/Tag";
import { Row, Section } from "./Section";

export function FeedbackSection() {
  return (
    <>
      <Section id="badges" title="Pills and tags">
        <Row>
          <Pill tone="accent">UPLOADING</Pill>
          <Pill tone="ok">COMPLETE</Pill>
          <Pill tone="warn">PAUSED</Pill>
          <Pill tone="danger">PENDING DELETE</Pill>
          <Pill tone="info">MAINTENANCE</Pill>
          <Pill tone="warn" icon="gauge" className="uppercase">
            Busy
          </Pill>
        </Row>
        <Row>
          <Tag icon="globe-simple">Public</Tag>
          <Tag icon="timer">Expires in 2d 4h</Tag>
          <Tag icon="hash" size="sm">
            movie
          </Tag>
        </Row>
      </Section>

      <Section id="banners" title="Banners">
        <Banner icon="user-circle-plus" iconSize={22} align="center" title="Account banner title" onDismiss={() => undefined} actions={<Button variant="primary" size={34} icon="key">Save token</Button>}>
          Body text in 13px with 1.45 line height.
        </Banner>
        <Banner tone="warn" icon="warning" title="Storage almost full" titleColor="var(--color-warn-text)" actions={<Button size={32}>Manage files</Button>} onDismiss={() => undefined}>
          Uploads stop at 100%.
        </Banner>
        <Banner tone="danger" icon="warning" title="Storage is full" titleColor="var(--color-danger-text)" />
        <Banner tone="info" icon="wrench" title="Maintenance" titleColor="var(--color-info-text)" />
      </Section>

      <Section id="surfaces" title="Surfaces">
        <Card className="flex items-center gap-3.5 px-5 py-[18px]" data-testid="card">
          <Skeleton className="size-12 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2.5">
            <Skeleton className="h-[18px] w-[38%]" />
            <Skeleton className="h-3 w-[58%]" />
          </div>
          <Skeleton className="h-[34px] w-[84px] rounded-[10px]" />
        </Card>
        <ListCard>
          {["First row", "Second row", "Third row"].map((label) => (
            <ListRow key={label} className="px-4 py-3 text-[15px] font-bold">
              {label}
            </ListRow>
          ))}
        </ListCard>
        <ListCard>
          <EmptyState title="This folder is empty" description="Upload files or create a subfolder to get started." actions={<Button variant="primary" icon="upload-simple">Upload files</Button>} />
        </ListCard>
      </Section>

      <Section id="misc" title="Keys and logo">
        <Row>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
          <Kbd variant="hint">⌘K</Kbd>
          <Kbd variant="hint">Esc</Kbd>
        </Row>
        <Row>
          <Logo size={22} />
          <Logo size={28} withText className="text-[18px]" />
          <Logo size={64} />
        </Row>
      </Section>
    </>
  );
}
