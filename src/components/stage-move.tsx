import Link from "next/link";
import { moveStageAction } from "@/modules/episodes/actions";
import {
  boardStage,
  hasOpenDeal,
  nextMove,
  reachableColumns,
  type BoardEpisode,
} from "@/modules/episodes/board";
import { Button, inputClass } from "@/components/ui";

/**
 * The one control that moves a car forward.
 *
 * Deliberately ONE primary button with the destination written on it. The old
 * surface was six dropdowns of about seventy status values and no indication
 * which of them the Pipeline reads — correct, and unusable by anyone who had
 * not read the code. Everything unusual (going backwards, skipping a step) is
 * behind a disclosure, because it is rare and should cost a tap, while the
 * common case should cost none.
 *
 * `compact` renders the card version for the Pipeline board; the full version
 * carries the explanation line and the picker.
 */
export function StageMove({
  episode,
  episodeId,
  canEdit,
  compact = false,
}: {
  episode: BoardEpisode;
  episodeId: string;
  canEdit: boolean;
  compact?: boolean;
}) {
  const move = nextMove(episode, episodeId);
  if (!move) return null;

  if (move.kind === "link") {
    return (
      <div className={compact ? "mt-2" : "mt-3"}>
        <Link
          href={move.href}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 shadow-sm hover:bg-stone-50"
        >
          {move.label}
        </Link>
        {compact ? null : <p className="mt-1.5 text-xs text-stone-500">{move.explains}</p>}
      </div>
    );
  }

  if (!canEdit) return null;

  const others = reachableColumns(episode);

  return (
    <div className={compact ? "mt-2" : "mt-3"}>
      <form action={moveStageAction}>
        <input type="hidden" name="episodeId" value={episodeId} />
        <Button type="submit" variant="primary" className={compact ? "w-full px-3 text-left" : ""}>
          {move.label}
        </Button>
      </form>
      {compact ? null : <p className="mt-1.5 text-xs text-stone-500">{move.explains}</p>}

      {!compact && others.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-700">
            Put it somewhere else
          </summary>
          <form action={moveStageAction} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="episodeId" value={episodeId} />
            <div>
              <label htmlFor="stage-to" className="block text-xs font-medium text-stone-500">
                Move to
              </label>
              <select id="stage-to" name="to" defaultValue={others[0]} className={inputClass}>
                {others.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary">
              Move
            </Button>
          </form>
          <p className="mt-1.5 text-xs text-stone-500">
            Sending a live car back to prep takes its listing down.
          </p>
        </details>
      ) : null}
    </div>
  );
}

/** The line explaining why a car in a deal cannot be dragged around by hand. */
export function StageLockedNote({ episode }: { episode: BoardEpisode }) {
  if (!hasOpenDeal(episode) || !episode.active) return null;
  return (
    <p className="mt-3 text-xs text-stone-500">
      This car is on a deal, so its stage follows the deal — it moves on its own as the deposit,
      contract, funds and delivery are recorded. It is currently in{" "}
      <span className="font-medium text-stone-700">{boardStage(episode)}</span>.
    </p>
  );
}
