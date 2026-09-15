import { Schema, model } from "mongoose";

export interface CounterDoc {
  _id: string; // counter name
  nextValue: number;
}

const schema = new Schema<CounterDoc>({
  _id: { type: String },
  nextValue: { type: Number, required: true },
});

export const Counter = model<CounterDoc>("Counter", schema);
