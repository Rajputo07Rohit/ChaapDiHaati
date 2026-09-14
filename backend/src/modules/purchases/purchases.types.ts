export interface PurchaseItemInput {
  inventoryItemId: string;
  quantity: number;
  purchaseUnit: string;
  ratePaise?: number | null;
  pricePending?: boolean;
  notes?: string;
}

export interface RecordPurchaseInput {
  supplierId?: string;
  invoiceNumber?: string;
  businessDate?: string;
  paymentMethodId?: string;
  paymentStatus: "PAID" | "CREDIT" | "PARTIAL";
  amountPaidPaise?: number;
  items: PurchaseItemInput[];
  taxPaise?: number;
  discountPaise?: number;
  notes?: string;
}
