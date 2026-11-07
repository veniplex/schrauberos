"use client";

import { useRef, useState } from "react";
import { Bold, CheckSquare, Code, Heading2, ImagePlus, Italic, Link2, List, Table } from "lucide-react";
import { Checkbox, Field, FieldError, FileInput, Form, FormActions, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { saveDocPage } from "./actions";
import { Markdown } from "@/components/ui/markdown";
import { SegmentedControl } from "@/components/ui/segmented";
import { Alert } from "@/components/ui/layout";
import { DOC_AREAS_WITH_PASSWORD_HINT, DOC_IMAGE_MAX_BYTES } from "./areas";

export type DocEditorInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
  title: string;
  categoryId: string;
  content: string;
  pinned: boolean;
};

type Edit = { value: string; start: number; end: number };

/** Umschließt die Auswahl (oder fügt einen Platzhalter ein). */
function wrap(value: string, s: number, e: number, before: string, after: string, placeholder: string): Edit {
  const sel = value.slice(s, e) || placeholder;
  const next = value.slice(0, s) + before + sel + after + value.slice(e);
  return { value: next, start: s + before.length, end: s + before.length + sel.length };
}

/** Setzt ein Präfix vor jede betroffene Zeile. */
function prefixLines(value: string, s: number, e: number, prefix: string): Edit {
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  const block = value.slice(lineStart, e);
  const prefixed = block.split("\n").map((l) => prefix + l).join("\n");
  return { value: value.slice(0, lineStart) + prefixed + value.slice(e), start: s + prefix.length, end: lineStart + prefixed.length };
}

function ToolButton({ label, Icon, onClick }: { label: string; Icon: typeof Bold; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" title={label} aria-label={label} onClick={onClick}>
      <Icon className="size-4" aria-hidden />
    </Button>
  );
}

const TABLE_TEMPLATE = "\n| Spalte 1 | Spalte 2 |\n| --- | --- |\n| Wert | Wert |\n";

export function DocEditor({
  area,
  initial,
  categories,
  cancelHref,
}: {
  area: string;
  initial: DocEditorInitial;
  categories: Array<{ id: string; name: string }>;
  cancelHref: string;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState(initial.content);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function apply(fn: (value: string, s: number, e: number) => Edit) {
    const ta = ref.current;
    if (!ta) return;
    const edit = fn(content, ta.selectionStart, ta.selectionEnd);
    setContent(edit.value);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(edit.start, edit.end);
    });
  }

  async function upload(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("area", area);
      fd.set("file", file);
      const res = await fetch("/api/docs/images", { method: "POST", body: fd, headers: { "X-Requested-With": "schrauberos" } });
      if (!res.ok) {
        setUploadError(res.status === 413 ? t("docs.errors.imageSize") : res.status === 415 ? t("docs.errors.imageType") : t("docs.errors.upload"));
        return;
      }
      const { url } = (await res.json()) as { url: string };
      const alt = file.name.replace(/\.[^.]+$/, "") || "Bild";
      apply((v, s, e) => {
        const snippet = `\n![${alt}](${url})\n`;
        return { value: v.slice(0, s) + snippet + v.slice(e), start: s + snippet.length, end: s + snippet.length };
      });
    } catch {
      setUploadError(t("docs.errors.upload"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Form action={saveDocPage} warnOnLeave className="flex flex-col gap-4">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}
      <input type="hidden" name="area" value={area} />
      {(DOC_AREAS_WITH_PASSWORD_HINT as readonly string[]).includes(area) ? <Alert tone="warning">{t("docs.noPasswordsHint")}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Field label={t("docs.fields.title")} htmlFor="title" name="title" required>
          <Input id="title" name="title" defaultValue={initial.title} maxLength={120} required autoComplete="off" />
        </Field>
        <Field label={t("docs.fields.category")} htmlFor="categoryId" name="categoryId">
          <Select id="categoryId" name="categoryId" defaultValue={initial.categoryId}>
            <option value="">{t("docs.noCategory")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Fokusring am Rahmen: Die Textfläche selbst hat keinen (er würde vom overflow-hidden abgeschnitten) */}
      <div className="overflow-hidden rounded-lg border border-line-strong focus-within:border-accent-text focus-within:ring-2 focus-within:ring-accent-text">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-2 py-1">
          <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label={t("docs.toolbar")}>
            <ToolButton label={t("docs.tools.bold")} Icon={Bold} onClick={() => apply((v, s, e) => wrap(v, s, e, "**", "**", t("docs.tools.boldText")))} />
            <ToolButton label={t("docs.tools.italic")} Icon={Italic} onClick={() => apply((v, s, e) => wrap(v, s, e, "_", "_", t("docs.tools.italicText")))} />
            <ToolButton label={t("docs.tools.heading")} Icon={Heading2} onClick={() => apply((v, s, e) => prefixLines(v, s, e, "## "))} />
            <ToolButton label={t("docs.tools.list")} Icon={List} onClick={() => apply((v, s, e) => prefixLines(v, s, e, "- "))} />
            <ToolButton label={t("docs.tools.checklist")} Icon={CheckSquare} onClick={() => apply((v, s, e) => prefixLines(v, s, e, "- [ ] "))} />
            <ToolButton label={t("docs.tools.link")} Icon={Link2} onClick={() => apply((v, s, e) => wrap(v, s, e, "[", "](https://)", t("docs.tools.linkText")))} />
            <ToolButton label={t("docs.tools.code")} Icon={Code} onClick={() => apply((v, s, e) => (v.slice(s, e).includes("\n") ? wrap(v, s, e, "\n```\n", "\n```\n", "") : wrap(v, s, e, "`", "`", "code")))} />
            <ToolButton label={t("docs.tools.table")} Icon={Table} onClick={() => apply((v, s, e) => ({ value: v.slice(0, s) + TABLE_TEMPLATE + v.slice(e), start: s + TABLE_TEMPLATE.length, end: s + TABLE_TEMPLATE.length }))} />
            <ToolButton label={uploading ? t("docs.tools.uploading") : t("docs.tools.image")} Icon={ImagePlus} onClick={() => fileRef.current?.click()} />
            <FileInput
              ref={fileRef}
              accept="image/png,image/jpeg,image/webp,image/gif"
              maxBytes={DOC_IMAGE_MAX_BYTES}
              onReject={() => setUploadError(t("docs.errors.imageSize"))}
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </div>
          <SegmentedControl
            label={t("docs.view")}
            value={tab}
            onChange={setTab}
            options={(["edit", "preview"] as const).map((k) => ({ value: k, label: t(`docs.tabs.${k}`) }))}
          />
        </div>

        {/* ui-kit-exception: Editorfläche ohne eigenen Rand – bildet mit Werkzeugleiste und Vorschau eine Einheit */}
        <textarea
          ref={ref}
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={(e) => {
            const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
            if (file) {
              e.preventDefault();
              void upload(file);
            }
          }}
          hidden={tab !== "edit"}
          spellCheck
          aria-label={t("docs.fields.content")}
          placeholder={t("docs.fields.contentPlaceholder")}
          className="block min-h-[26rem] w-full resize-y bg-surface p-4 font-mono text-[13px] leading-relaxed text-ink outline-none focus-visible:outline-none max-lg:text-base pointer-coarse:text-base"
        />
        {tab === "preview" ? (
          <div className="min-h-[26rem] bg-surface p-5">
            {content.trim() ? <Markdown source={content} /> : <p className="text-sm text-ink-muted">{t("docs.previewEmpty")}</p>}
          </div>
        ) : null}
      </div>
      {uploadError ? <FieldError>{uploadError}</FieldError> : null}
      <p className="text-xs text-ink-muted">{t("docs.markdownHint")}</p>

      <Checkbox name="pinned" defaultChecked={initial.pinned} label={t("docs.fields.pinned")} />

      <FormActions cancelHref={cancelHref} />
    </Form>
  );
}
