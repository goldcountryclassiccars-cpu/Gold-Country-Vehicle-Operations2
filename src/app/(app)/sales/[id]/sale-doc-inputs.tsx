/**
 * The Create Sale Docs form.
 *
 * Every field carries a "why we ask" line, because the answer to "why does this
 * matter?" is exactly what decides whether the deal needs another document, and
 * an employee who understands the question fills it in correctly. Jade's stated
 * worry drives this: the team will resist anything that feels like arbitrary
 * data entry.
 *
 * A field left blank stays blank. Nothing here is defaulted — the checklist
 * reports UNKNOWN, which is a more useful answer than a confident guess.
 */
import { readDay } from "@/lib/dealership-date";
import { MANUAL_ANSWER_FIELDS, SALE_INPUT_HINTS, readManualAnswers } from "@/modules/documents/context";
import { saveSaleDocumentInputsAction } from "@/modules/documents/actions";
import { Button, Card, inputClass } from "@/components/ui";

interface SaleInputs {
  id: string;
  saleDate: Date | null;
  deliveryState: string | null;
  deliveryMethod: string | null;
  registrationState: string | null;
  outsideLender: boolean;
  negotiatedLanguage: string | null;
  odometerAtSale: number | null;
  salesTaxCollected: unknown;
  reg51SerialNo: string | null;
  tempPlateNo: string | null;
  manualAnswers: unknown;
}

function Hint({ children }: { children: string }) {
  return <p className="mt-1 text-xs leading-snug text-stone-500">{children}</p>;
}

export function SaleDocInputs({ sale, canEdit }: { sale: SaleInputs; canEdit: boolean }) {
  const manual = readManualAnswers(sale.manualAnswers);
  const taxBlank = sale.salesTaxCollected == null;

  return (
    <Card accent="blue">
      <h2 className="text-base font-semibold text-stone-900">Sale details for the paperwork</h2>
      <p className="mt-0.5 text-sm text-stone-600">
        These answers decide which documents this sale needs. Anything left blank shows on the checklist as
        &ldquo;unknown&rdquo; rather than being guessed.
      </p>

      <form action={saveSaleDocumentInputsAction} className="mt-4 space-y-5">
        <input type="hidden" name="saleId" value={sale.id} />
        <input type="hidden" name="manualAnswersPresent" value="1" />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sd-date" className="block text-sm font-medium text-stone-700">
              Sale date
            </label>
            <input
              id="sd-date"
              name="saleDate"
              type="date"
              defaultValue={readDay(sale.saleDate) ?? ""}
              disabled={!canEdit}
              className={inputClass}
            />
            <Hint>{SALE_INPUT_HINTS.saleDate!}</Hint>
          </div>

          <div>
            <label htmlFor="sd-delivery-state" className="block text-sm font-medium text-stone-700">
              Delivery state
            </label>
            <input
              id="sd-delivery-state"
              name="deliveryState"
              maxLength={2}
              placeholder="CA"
              defaultValue={sale.deliveryState ?? ""}
              disabled={!canEdit}
              className={`${inputClass} uppercase`}
            />
            <Hint>{SALE_INPUT_HINTS.deliveryState!}</Hint>
          </div>

          <div>
            <label htmlFor="sd-delivery-method" className="block text-sm font-medium text-stone-700">
              How the buyer takes it
            </label>
            <select
              id="sd-delivery-method"
              name="deliveryMethod"
              defaultValue={sale.deliveryMethod ?? ""}
              disabled={!canEdit}
              className={inputClass}
            >
              <option value="">Not decided yet</option>
              <option value="BUYER_PICKUP">Buyer picks it up here</option>
              <option value="DEALER_DELIVERS">We deliver it</option>
              <option value="COMMON_CARRIER">Common carrier</option>
            </select>
            <Hint>{SALE_INPUT_HINTS.deliveryMethod!}</Hint>
          </div>

          <div>
            <label htmlFor="sd-registration-state" className="block text-sm font-medium text-stone-700">
              Registration state
            </label>
            <input
              id="sd-registration-state"
              name="registrationState"
              maxLength={2}
              placeholder="CA"
              defaultValue={sale.registrationState ?? ""}
              disabled={!canEdit}
              className={`${inputClass} uppercase`}
            />
            <Hint>{SALE_INPUT_HINTS.registrationState!}</Hint>
          </div>

          <div>
            <label htmlFor="sd-language" className="block text-sm font-medium text-stone-700">
              Language the deal was negotiated in
            </label>
            <select
              id="sd-language"
              name="negotiatedLanguage"
              defaultValue={sale.negotiatedLanguage ?? ""}
              disabled={!canEdit}
              className={inputClass}
            >
              <option value="">Not recorded</option>
              <option value="EN">English</option>
              <option value="ES">Spanish</option>
              <option value="OTHER">Other</option>
            </select>
            <Hint>{SALE_INPUT_HINTS.negotiatedLanguage!}</Hint>
          </div>

          <div>
            <label htmlFor="sd-odometer" className="block text-sm font-medium text-stone-700">
              Odometer reading at sale
            </label>
            <input
              id="sd-odometer"
              name="odometerAtSale"
              type="number"
              min="0"
              inputMode="numeric"
              defaultValue={sale.odometerAtSale ?? ""}
              disabled={!canEdit}
              className={inputClass}
            />
            <Hint>{SALE_INPUT_HINTS.odometerAtSale!}</Hint>
          </div>

          <div>
            <label htmlFor="sd-tax" className="block text-sm font-medium text-stone-700">
              Sales tax collected ($)
            </label>
            <input
              id="sd-tax"
              name="salesTaxCollected"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              defaultValue={sale.salesTaxCollected == null ? "" : String(sale.salesTaxCollected)}
              disabled={!canEdit}
              className={inputClass}
            />
            <Hint>{SALE_INPUT_HINTS.salesTaxCollected!}</Hint>
            {sale.deliveryState === "CA" && taxBlank ? (
              <p role="alert" className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                Delivery is in California and no tax is recorded. The app does not calculate tax — check this before
                the REG 51 goes in.
              </p>
            ) : null}
          </div>

          <div className="flex items-start gap-2 pt-6">
            <input
              id="sd-lender"
              name="outsideLender"
              type="checkbox"
              defaultChecked={sale.outsideLender}
              disabled={!canEdit}
              className="mt-1 h-5 w-5 rounded border-stone-300"
            />
            <div>
              <label htmlFor="sd-lender" className="text-sm font-medium text-stone-700">
                Buyer is using an outside lender
              </label>
              <Hint>{SALE_INPUT_HINTS.outsideLender!}</Hint>
            </div>
          </div>
        </div>

        <fieldset className="rounded-lg border border-stone-200 p-4">
          <legend className="px-1 text-sm font-semibold text-stone-900">What the paperwork in front of you shows</legend>
          <p className="mb-3 text-xs text-stone-500">
            Facts about the actual title and the deal that nothing else in the app knows. Leave a box unticked only if
            it is genuinely a no — these save and are treated as answered.
          </p>
          <div className="space-y-3">
            {MANUAL_ANSWER_FIELDS.map((field) => (
              <div key={field.key} className="flex items-start gap-2">
                <input
                  id={`ma-${field.key}`}
                  name={field.key}
                  type="checkbox"
                  defaultChecked={manual[field.key] === true}
                  disabled={!canEdit}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-stone-300"
                />
                <div className="min-w-0">
                  <label htmlFor={`ma-${field.key}`} className="text-sm font-medium text-stone-700">
                    {field.label}
                  </label>
                  <Hint>{field.hint}</Hint>
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        <details className="rounded-lg border border-stone-200 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-stone-900">
            DMV numbers issued (REG 51, temporary plate)
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sd-reg51" className="block text-sm font-medium text-stone-700">
                REG 51 serial number
              </label>
              <input
                id="sd-reg51"
                name="reg51SerialNo"
                defaultValue={sale.reg51SerialNo ?? ""}
                disabled={!canEdit}
                className={inputClass}
              />
              <Hint>Record the serial of the form you used, so the book can be reconciled.</Hint>
            </div>
            <div>
              <label htmlFor="sd-tlp" className="block text-sm font-medium text-stone-700">
                Temporary plate (TLP) number
              </label>
              <input
                id="sd-tlp"
                name="tempPlateNo"
                defaultValue={sale.tempPlateNo ?? ""}
                disabled={!canEdit}
                className={inputClass}
              />
              <Hint>Out-of-state buyers driving home need this.</Hint>
            </div>
          </div>
        </details>

        {canEdit ? (
          <Button type="submit" className="w-full sm:w-auto">
            Save and check the paperwork
          </Button>
        ) : (
          <p className="text-xs text-stone-500">You do not have permission to change these.</p>
        )}
      </form>
    </Card>
  );
}
