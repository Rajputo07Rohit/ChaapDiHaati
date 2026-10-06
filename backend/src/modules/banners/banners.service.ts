import { Banner, BannerDoc } from "../../db/models";
import { newId, nowIso } from "../../utils/ids";
import { NotFoundError, ValidationError } from "../../utils/errors";

export interface BannerRow {
  id: string;
  image_url: string;
  title: string | null;
  link_url: string | null;
  active: boolean;
  sort_order: number;
}

function toRow(doc: BannerDoc): BannerRow {
  return {
    id: doc._id,
    image_url: doc.imageUrl,
    title: doc.title,
    link_url: doc.linkUrl,
    active: doc.active,
    sort_order: doc.sortOrder,
  };
}

export async function createBanner(input: { imageUrl: string; title?: string | null; linkUrl?: string | null; userId: string }): Promise<BannerRow> {
  if (!input.imageUrl) throw new ValidationError("An image is required.");
  const count = await Banner.countDocuments();
  const id = newId("banner");
  await Banner.create({
    _id: id,
    imageUrl: input.imageUrl,
    title: input.title?.trim() || null,
    linkUrl: input.linkUrl?.trim() || null,
    active: true,
    sortOrder: count,
    createdBy: input.userId,
    createdAt: nowIso(),
  });
  return toRow((await Banner.findById(id))!);
}

export async function listBanners(): Promise<BannerRow[]> {
  const docs = await Banner.find().sort({ sortOrder: 1, createdAt: -1 });
  return docs.map(toRow);
}

export async function listActiveBannersForCustomer(): Promise<BannerRow[]> {
  const docs = await Banner.find({ active: true }).sort({ sortOrder: 1 });
  return docs.map(toRow);
}

export async function setBannerActive(id: string, active: boolean): Promise<BannerRow> {
  const doc = await Banner.findById(id);
  if (!doc) throw new NotFoundError("Banner");
  doc.active = active;
  await doc.save();
  return toRow(doc);
}

export async function reorderBanner(id: string, sortOrder: number): Promise<BannerRow> {
  const doc = await Banner.findById(id);
  if (!doc) throw new NotFoundError("Banner");
  doc.sortOrder = sortOrder;
  await doc.save();
  return toRow(doc);
}

export async function deleteBanner(id: string): Promise<void> {
  const doc = await Banner.findById(id);
  if (!doc) throw new NotFoundError("Banner");
  await doc.deleteOne();
}
