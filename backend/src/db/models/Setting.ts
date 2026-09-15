import { Schema, model } from "mongoose";

export interface SettingDoc {
  _id: string; // the setting key
  value: unknown;
  updatedBy: string | null;
  updatedAt: string;
}

const schema = new Schema<SettingDoc>({
  _id: { type: String },
  value: { type: Schema.Types.Mixed, required: true },
  updatedBy: { type: String, default: null },
  updatedAt: { type: String, required: true },
});

export const Setting = model<SettingDoc>("Setting", schema);
