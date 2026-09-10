/**
 * Sale documents — setup.
 *
 * The answer to "how do I turn on real documents?", in the app, where the
 * person who has to gather the paperwork can actually see it. Until this
 * existed the app's answer was a pointer at a markdown file inside the code
 * repository.
 *
 * Two halves: what the dealership still owes, and the documents themselves
 * with a way to load an approved file against each one.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { documentSetupState, type SetupItem } from "@/modules/documents/setup";
import { setSetupItemAction, clearApprovedTemplateAction } from "@/modules/documents/setup-actions";
import { Badge, Card, PageHeader, inputClass, type BadgeTone } from "@/components/ui";
import { DataTable, type Column } from "@/components/data-table";

export const metadata: Metadata = { title: "Sale documents — setup" };

const STATUS_TONE: Record<string, BadgeTone> = { done: "green", partial: "amber", todo: "neutral" };
const STATUS_LABEL: Record<string, string> = { done: "Done", partial: "Part done", todo: "Still needed" };

const CATEGORY_SHORT: Record<number, string> = {
  1: "We produce",
  2: "Government form",
  3: "Controlled original",
  4: "Third party",
};

/**
 * Which documents it makes sense to hold a blank master for.
 *
 * Category 1 is ours to produce, and category 2 is a government form we print
 * and fill — a blank of each is exactly the right thing to store.
 *
 * Category 3 must not offer this. A REG 51 is a serialised form the DMV issues;
 * there is no blank to upload, and inviting someone to try is inviting the
 * wrong action. Category 4 documents belong to one car and one sale — a smog
 * certificate for *this* Datsun — so they are collected on the deal itself,
 * not held as a master here.
 */
function acceptsBlankMaster(category: number): boolean {
  return category === 1 || category === 2;
}

function statusBadge(category: number, approved: boolean) {
  if (category === 3) return <Badge tone="slate">Controlled original</Badge>;
  if (category === 4) return <Badge tone="blue">Collected per sale</Badge>;
  if (approved) return <Badge tone="green">{category === 1 ? "Approved copy loaded" : "Blank form loaded"}</Badge>;
  return <Badge tone="amber">{category === 1 ? "Demo watermark" : "No blank loaded"}</Badge>;
}

function SetupRow({ item }: { item: SetupItem }) {
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      {/* The badge keeps its own column rather than wrapping, so a reader can
          run their eye down the right-hand edge instead of hunting for it. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-stone-900">
            <span className="text-stone-400">{item.number}.</span> {item.title}
          </p>
          <p className="mt-1 text-sm text-stone-600">{item.need}</p>
        </div>
        <span className="shrink-0">
          <Badge tone={STATUS_TONE[item.status] ?? "neutral"}>{STATUS_LABEL[item.status] ?? item.status}</Badge>
        </span>
      </div>

      <p className={`mt-2 text-sm ${item.status === "done" ? "text-emerald-800" : "text-stone-700"}`}>{item.detail}</p>

      {item.href ? (
        <Link href={item.href} className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">
          {item.hrefLabel ?? "Open"} →
        </Link>
      ) : null}

      {item.answerable ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-stone-500 hover:text-stone-800">
            {item.status === "done" ? "Change this answer" : "Record an answer"}
          </summary>
          <form action={setSetupItemAction} className="mt-2 space-y-2">
            <input type="hidden" name="key" value={item.key} />
            <label htmlFor={`note-${item.key}`} className="block text-xs font-medium text-stone-500">
              What was decided, and by whom
            </label>
            <textarea
              id={`note-${item.key}`}
              name="note"
              rows={2}
              defaultValue={item.note ?? ""}
              placeholder="e.g. Reviewed with counsel 2026-10-02 — no changes requested."
              className={inputClass}
            />
            <div className="flex flex-wrap gap-2">
              <button
                name="provided"
                value="yes"
                className="min-h-11 rounded-lg border border-brand-800 bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800"
              >
                Mark provided
              </button>
              <button
                name="provided"
                value="no"
                className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-stone-50"
              >
                Still outstanding
              </button>
            </div>
          </form>
        </details>
      ) : null}

      {item.providedAt ? (
        <p className="mt-2 text-xs text-stone-400">Recorded {new Date(item.providedAt).toLocaleDateString()}.</p>
      ) : null}
    </li>
  );
}

export default async function DocumentSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ loaded?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "manage_config", "admin");
  const { loaded, error } = await searchParams;

  const [setup, templates] = await Promise.all([
    documentSetupState(),
    db.documentTemplate.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }),
  ]);

  const columns: Column<(typeof templates)[number]>[] = [
    {
      key: "name",
      header: "Document",
      phone: "title",
      cell: (t) => (
        <div className="min-w-0">
          <span className="font-medium text-stone-900">{t.name}</span>
          <p className="text-xs text-stone-400">
            {CATEGORY_SHORT[t.category] ?? `Category ${t.category}`}
            {t.authority ? ` · ${t.authority}` : ""}
          </p>
          {t.approvedVersionNote ? (
            <p className="text-xs text-stone-500">Version: {t.approvedVersionNote}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "state",
      header: "Status",
      phone: "meta",
      cell: (t) => statusBadge(t.category, Boolean(t.approvedFileId)),
    },
    {
      key: "load",
      header: "Approved file",
      cell: (t) =>
        !acceptsBlankMaster(t.category) ? (
          <p className="text-xs text-stone-500">
            {t.category === 3
              ? "Serialised or original — the DMV issues it. The app tracks it and gives you a fill worksheet."
              : "Arrives per sale from a third party. Attach it on the deal's checklist."}
          </p>
        ) : (
        <div className="space-y-2">
          {t.approvedFileId ? (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/api/files/${t.approvedFileId}`}
                target="_blank"
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                Open current
              </a>
              <form action={clearApprovedTemplateAction} className="flex items-center gap-1">
                <input type="hidden" name="templateKey" value={t.key} />
                <label htmlFor={`clr-${t.key}`} className="sr-only">
                  Reason for removing the approved {t.name}
                </label>
                <input
                  id={`clr-${t.key}`}
                  name="reason"
                  placeholder="Reason (audited)"
                  className="w-40 rounded border border-stone-300 px-2 py-1 text-xs"
                />
                <button className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">Remove</button>
              </form>
            </div>
          ) : null}

          <form
            action="/api/documents/approved-template"
            method="post"
            encType="multipart/form-data"
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="templateKey" value={t.key} />
            <input type="hidden" name="redirectTo" value="/admin/documents" />
            <label htmlFor={`file-${t.key}`} className="sr-only">
              Approved file for {t.name}
            </label>
            <input
              id={`file-${t.key}`}
              type="file"
              name="file"
              accept=".pdf,.doc,.docx,application/pdf"
              required
              className="max-w-[13rem] text-xs"
            />
            <label htmlFor={`ver-${t.key}`} className="sr-only">
              Version note for {t.name}
            </label>
            <input
              id={`ver-${t.key}`}
              name="versionNote"
              placeholder="Version / date"
              className="w-32 rounded border border-stone-300 px-2 py-1 text-xs"
            />
            <button className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold shadow-sm hover:bg-stone-50">
              {t.approvedFileId ? "Replace" : t.category === 1 ? "Load approved" : "Load blank form"}
            </button>
          </form>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Sale documents — setup"
        subtitle="What the dealership still needs to provide before the app can produce real documents, and where each one stands."
        actions={
          <Link
            href="/admin"
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
          >
            Administration
          </Link>
        }
      />

      {loaded ? (
        <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Approved template loaded for <strong>{loaded}</strong>. New documents generated for that row use it instead of
          the demonstration copy.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error === "nofile" ? "Choose a file first." : error}
        </p>
      ) : null}

      <Card accent={setup.complete ? "green" : "amber"} className="mb-6">
        <h2 className="text-base font-semibold text-stone-900">
          {setup.done} of {setup.total} setup items done
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          {setup.complete
            ? "Everything on the list is recorded. Documents with an approved copy loaded generate without a watermark."
            : `Until these are settled, generated documents stay watermarked "DEMONSTRATION — NOT AN APPROVED LEGAL DOCUMENT". ${setup.templatesApproved} of ${setup.templatesTotal} documents have an approved copy loaded.`}
        </p>
        <p className="mt-2 text-xs text-stone-500">
          Nothing here is legal advice. The rules in this app are a starting point for your compliance resource to
          confirm, not a substitute for one.
        </p>
      </Card>

      <h2 className="mb-3 text-lg font-semibold tracking-tight text-stone-900">What we still need from you</h2>
      <ul className="space-y-3">
        {setup.items.map((item) => (
          <SetupRow key={item.key} item={item} />
        ))}
      </ul>

      <h2 className="mb-1 mt-8 text-lg font-semibold tracking-tight text-stone-900">The documents themselves</h2>
      <p className="mb-3 text-sm text-stone-600">
        Load the approved copy of a document we produce, or the blank of a government form, and the app serves that
        instead of a watermarked demo. Do them as they come back from counsel — one document being ready does not wait
        on the rest. The app stores and serves what you upload; it never edits approved legal text.
        <br />
        Controlled originals like the REG 51 and the title are not uploadable — the DMV issues those, and the app
        tracks them and prints a fill worksheet. Third-party documents such as a smog certificate belong to one sale
        and are attached on that deal.
      </p>
      <DataTable
        caption="Document templates and their approved copies"
        columns={columns}
        rows={templates}
        rowKey={(t) => t.key}
      />
    </div>
  );
}
