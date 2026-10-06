import { Schema, model } from "mongoose";

export interface BannerDoc {
  _id: string;
  imageUrl: string;
  title: string | null;
  /** Optional deep link — e.g. jump straight to a category or a promo code. Opened in the customer app on tap. */
  linkUrl: string | null;
  active: boolean;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
}

const bannerSchema = new Schema<BannerDoc>({
  _id: { type: String },
  imageUrl: { type: String, required: true },
  title: { type: String, default: null },
  linkUrl: { type: String, default: null },
  active: { type: Boolean, required: true, default: true },
  sortOrder: { type: Number, required: true, default: 0 },
  createdBy: { type: String, default: null },
  createdAt: { type: String, required: true },
});
bannerSchema.index({ active: 1, sortOrder: 1 });

export const Banner = model<BannerDoc>("Banner", bannerSchema);
