import { Button, Modal } from "./ui/Primitives";

/**
 * Shown when completing/delivering an order hits a recipe ingredient whose
 * inventory record no longer exists (a data problem, not an out-of-stock
 * one — those already go through silently with a warning). Staff can still
 * finish the sale; the affected ingredients just won't be deducted from
 * stock, and it's logged for whoever needs to fix the recipe/inventory.
 */
export function InventoryMissingDialog({
  open,
  missingItems,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  missingItems: string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title="Inventory record missing">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Some ingredients on this order don't have a matching inventory item, so stock can't be deducted for them:
        </p>
        <ul className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3 space-y-1">
          {missingItems.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <p className="text-sm text-slate-600">You can still create this order — those ingredients just won't be tracked in inventory for this sale.</p>
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={onConfirm} disabled={busy}>
            {busy ? "Creating…" : "Create order anyway"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
