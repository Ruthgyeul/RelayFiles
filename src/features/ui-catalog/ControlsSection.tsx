"use client";

import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/shared/ui/Button";
import { Field, FieldGroup, TextArea, TextInput } from "@/shared/ui/Field";
import { IconButton } from "@/shared/ui/IconButton";
import { CheckRow, OptionCard, OptionChip } from "@/shared/ui/Option";
import { Row, Section } from "./Section";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger-outline", "danger-solid"];
const SIZES: ButtonSize[] = [28, 30, 32, 34, 36, 38, 40, 44];

export function ControlsSection() {
  const [choice, setChoice] = useState("both");
  const [filter, setFilter] = useState("all");
  const [visibility, setVisibility] = useState("private");
  const [checked, setChecked] = useState(true);

  return (
    <>
      <Section id="buttons" title="Buttons">
        {VARIANTS.map((variant) => (
          <Row key={variant}>
            <Button variant={variant} size={34} icon="upload-simple" hoverable data-testid={`button-${variant}`}>
              {variant}
            </Button>
            <Button variant={variant} size={32} icon="download-simple" hideLabelOnMobile hoverable>
              Label hidden on mobile
            </Button>
          </Row>
        ))}
        <Row>
          {SIZES.map((size) => (
            <Button key={size} variant="secondary" size={size} data-testid={`button-size-${size}`}>
              h{size}
            </Button>
          ))}
        </Row>
        <Row>
          <IconButton icon="dots-three-vertical" iconWeight="bold" label="More" hover="btn" data-testid="icon-button" />
          <IconButton icon="magnifying-glass" label="Search" size={36} iconSize={20} hover="btn" />
          <IconButton icon="list" label="Menu" size={40} iconSize={22} hover="nav" />
          <IconButton icon="x" label="Close" size={30} iconSize={16} tone="t2" />
        </Row>
      </Section>

      <Section id="options" title="Options">
        <Row>
          {[
            ["both", "Download + stream"],
            ["stream", "Stream only"],
          ].map(([value, label]) => (
            <OptionChip key={value} selected={choice === value} onClick={() => setChoice(value!)} data-testid={`option-${value}`}>
              {label}
            </OptionChip>
          ))}
          <OptionChip disabled>Disabled</OptionChip>
        </Row>
        <Row>
          {[
            ["all", "All", "squares-four", 12],
            ["video", "Videos", "film-strip", 3],
            ["image", "Images", "image", 6],
          ].map(([value, label, icon, count]) => (
            <OptionChip
              key={value as string}
              variant="filter"
              selected={filter === value}
              icon={icon as "image"}
              count={count as number}
              onClick={() => setFilter(value as string)}
            >
              {label}
            </OptionChip>
          ))}
        </Row>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
          <OptionCard selected={visibility === "private"} icon="lock-key" description="Only you can open it" onClick={() => setVisibility("private")}>
            Private
          </OptionCard>
          <OptionCard selected={visibility === "public"} icon="globe-simple" description="Anyone with the link" onClick={() => setVisibility("public")}>
            Public
          </OptionCard>
          <OptionCard surface="elev" icon="circle" iconSize={20} iconColor="var(--accentHi)" description="No new accounts">
            Closed
          </OptionCard>
        </div>
        <CheckRow checked={checked} onCheckedChange={setChecked}>
          Delete after the first download
        </CheckRow>
        <CheckRow checked={!checked} onCheckedChange={(v) => setChecked(!v)} description="Resets their own visibility so everything inside follows this folder.">
          Apply to all subfolders and files
        </CheckRow>
      </Section>

      <Section id="fields" title="Fields">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-3">
          <Field label="Max downloads">
            <TextInput placeholder="Unlimited" inputMode="numeric" data-testid="text-input" />
          </Field>
          <Field label="Password">
            <TextInput type="password" placeholder="None" />
          </Field>
        </div>
        <Field label="Account token">
          <TextInput height={44} surface="sunk" mono placeholder="40-character token" />
        </Field>
        <FieldGroup label="Note (shown on the share page)">
          <TextArea rows={3} />
        </FieldGroup>
      </Section>
    </>
  );
}
