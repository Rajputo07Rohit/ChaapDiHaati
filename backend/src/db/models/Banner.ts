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

/** Banner image bytes, stored in MongoDB rather than on disk — the hosting
 * disk is wiped on every restart/redeploy, which silently broke uploaded
 * banners (the row survived, the file didn't). */
export interface BannerImageDoc {
  _id: string; // same id as the Banner it belongs to
  contentType: string;
  data: Buffer;
}

const bannerImageSchema = new Schema<BannerImageDoc>({
  _id: { type: String },
  contentType: { type: String, required: true },
  data: { type: Buffer, required: true },
});

export const BannerImage = model<BannerImageDoc>("BannerImage", bannerImageSchema);
