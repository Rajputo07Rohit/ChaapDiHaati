import { Schema, model } from "mongoose";

export interface MenuCategoryDoc {
  _id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

const categorySchema = new Schema<MenuCategoryDoc>({
  _id: { type: String },
  name: { type: String, required: true, unique: true },
  sortOrder: { type: Number, required: true, default: 0 },
  active: { type: Boolean, required: true, default: true },
});

export const MenuCategory = model<MenuCategoryDoc>("MenuCategory", categorySchema);

export type MenuItemStatus = "ACTIVE" | "UNAVAILABLE" | "DISCONTINUED";

/** A configurable paid extra (e.g. "Extra Cream", "Extra Cheese") a
 * customer/staff can add to this item at order time. Editing or removing
 * one here never touches past orders — resolveOrderItems snapshots the
 * name/price onto the order item itself (see OrderItemAddonSub). */
export interface MenuItemAddonDoc {
  _id: string;
  name: string;
  pricePaise: number;
  active: boolean;
}

export interface MenuItemDoc {
  _id: string;
  categoryId: string;
  name: string;
  hasHalf: boolean;
  hasFull: boolean;
  hasSingle: boolean;
  unitLabel: string;
  halfLabel: string;
  fullLabel: string;
  status: MenuItemStatus;
  sortOrder: number;
  addons: MenuItemAddonDoc[];
  /** Dish photo shown on the customer app's menu card. Null until an admin sets one. */
  imageUrl: string | null;
  createdAt: string;
}

const addonSchema = new Schema<MenuItemAddonDoc>({
  _id: { type: String },
  name: { type: String, required: true },
  pricePaise: { type: Number, required: true, min: 0 },
  active: { type: Boolean, required: true, default: true },
});

const itemSchema = new Schema<MenuItemDoc>({
  _id: { type: String },
  categoryId: { type: String, required: true, ref: "MenuCategory" },
  name: { type: String, required: true },
  hasHalf: { type: Boolean, required: true, default: false },
  hasFull: { type: Boolean, required: true, default: false },
  hasSingle: { type: Boolean, required: true, default: false },
  unitLabel: { type: String, required: true, default: "plate" },
  halfLabel: { type: String, required: true, default: "Half" },
  fullLabel: { type: String, required: true, default: "Full" },
  status: { type: String, required: true, enum: ["ACTIVE", "UNAVAILABLE", "DISCONTINUED"], default: "ACTIVE" },
  sortOrder: { type: Number, required: true, default: 0 },
  addons: { type: [addonSchema], required: true, default: [] },
  imageUrl: { type: String, default: null },
  createdAt: { type: String, required: true },
});
itemSchema.index({ categoryId: 1 });
itemSchema.index({ status: 1 });

export const MenuItem = model<MenuItemDoc>("MenuItem", itemSchema);

export type PriceType = "HALF" | "FULL" | "SINGLE";

export interface MenuPriceDoc {
  _id: string;
  menuItemId: string;
  priceType: PriceType;
  pricePaise: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string | null;
  createdAt: string;
}

const priceSchema = new Schema<MenuPriceDoc>({
  _id: { type: String },
  menuItemId: { type: String, required: true, ref: "MenuItem" },
  priceType: { type: String, required: true, enum: ["HALF", "FULL", "SINGLE"] },
  pricePaise: { type: Number, required: true, min: 0 },
  effectiveFrom: { type: String, required: true },
  effectiveTo: { type: String, default: null },
  createdBy: { type: String, default: null },
  createdAt: { type: String, required: true },
});
priceSchema.index({ menuItemId: 1, priceType: 1, effectiveTo: 1 });

export const MenuPrice = model<MenuPriceDoc>("MenuPrice", priceSchema);
