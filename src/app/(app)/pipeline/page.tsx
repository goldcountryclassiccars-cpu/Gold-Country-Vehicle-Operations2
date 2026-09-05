import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { episodeWhereForUser } from "@/modules/episodes/service";
import {
  BOARD_BLURB,
  BOARD_BORDER,
  BOARD_COLUMNS,
  BOARD_DOT,
  boardStage,
  type BoardStage,
} from "@/modules/episodes/board";
import { vehicleLabel } from "@/modules/vehicles/service";
import { StageMove } from "@/components/stage-move";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Pipeline" };

/**
 * Six columns, and one button per card that says where the car goes next.
 *
 * The board used to draw eleven computed stages and offer no way to move
 * anything — every move meant opening the vehicle and setting the right one of
 * six status dropdowns, with nothing on screen saying which. See
 * `src/modules/episodes/board.ts` for what each button writes.
 *
 * Columns render even when empty, because an empty column is information ("no
 * cars waiting on photos") and a board that changes shape as cars move is
 * harder to read than one that stays still.
 */
export default async function PipelinePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "episodes");
  const canEdit = hasPermission(user, "episodes", "edit");

  const episodes = await db.inventoryEpisode.findMany({
    where: { AND: [episodeWhereForUser(user), { active: true }] },
    include: { vehicle: true },
    orderBy: { createdAt: "asc" },
  });

  const byStage = new Map<BoardStage, typeof episodes>();
  for (const s of BOARD_COLUMNS) byStage.set(s, []);
  for (const e of episodes) {
    const stage = boardStage(e);
    if (byStage.has(stage)) byStage.get(stage)!.push(e);
  }

  return (
    <div className="mx-auto max-w-[100rem]">
      <PageHeader
        title="Pipeline"
        subtitle="Where every car is right now. The button on a card moves it to the next step."
      />
      {episodes.length === 0 ? (
        <EmptyState
          title="No active inventory"
          hint="Vehicles appear here from acceptance through financial close."
        />
      ) : (
        /* A wrapping grid, NOT a scrolling row of six columns. Six kanban
         * columns need ~1600px; a laptop behind the 256px sidebar has ~1100,
         * so a single row would put the last two stages off-screen — the exact
         * "spreads outside the viewable area" complaint this app already fixed
         * once for tables. Wrapping reads Expected → Delivered left-to-right,
         * then top-to-bottom, and never scrolls sideways at any width. */
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {BOARD_COLUMNS.map((stage) => {
            const cars = byStage.get(stage)!;
            return (
              <section key={stage}>
                <div className="mb-2 rounded-md bg-white px-3 py-2 shadow-sm">
                  <h2 className="flex items-center justify-between text-sm font-semibold text-stone-700">
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${BOARD_DOT[stage]}`}
                        aria-hidden="true"
                      />
                      {stage}
                    </span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                      {cars.length}
                    </span>
                  </h2>
                  <p className="mt-0.5 text-xs text-stone-500">{BOARD_BLURB[stage]}</p>
                </div>

                {cars.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-stone-300 px-3 py-4 text-center text-xs text-stone-400">
                    Nothing here
                  </p>
                ) : (
                  <div className="space-y-2">
                    {cars.map((e) => (
                      <div
                        key={e.id}
                        className={`rounded-lg border border-stone-200 border-l-4 bg-white p-3 shadow-sm ${BOARD_BORDER[stage]}`}
                      >
                        <Link href={`/episodes/${e.id}`} className="block hover:underline">
                          <p className="text-sm font-medium text-stone-900">{vehicleLabel(e.vehicle)}</p>
                        </Link>
                        <p className="mt-0.5 text-xs text-stone-500">
                          {e.stockNumber} · {e.dealType === "CONSIGNMENT" ? "Consignment" : "Dealer-owned"}
                        </p>
                        {e.askingPrice ? (
                          <p className="mt-1 text-xs font-medium text-stone-700">
                            ${Number(e.askingPrice).toLocaleString()}
                          </p>
                        ) : null}
                        <StageMove episode={e} episodeId={e.id} canEdit={canEdit} compact />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
