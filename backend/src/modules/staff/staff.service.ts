import { Staff, StaffDoc } from "../../db/models";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { NotFoundError, ValidationError } from "../../utils/errors";

export type SalaryMethod = "CALENDAR_DAY" | "FIXED_30" | "WORKING_26" | "CUSTOM";

export interface StaffInput {
  fullName: string;
  roleTitle: string;
  salaryPaise: number;
  salaryMethod: SalaryMethod;
  customDays?: number;
  joiningDate: string;
  phone?: string;
  userId?: string;
}

export interface StaffRow {
  id: string;
  full_name: string;
  role_title: string;
  salary_paise: number;
  salary_method: SalaryMethod;
  custom_days: number | null;
  joining_date: string;
  active: boolean;
  phone: string | null;
}

function toRow(doc: StaffDoc): StaffRow {
  return {
    id: doc._id,
    full_name: doc.fullName,
    role_title: doc.roleTitle,
    salary_paise: doc.salaryPaise,
    salary_method: doc.salaryMethod,
    custom_days: doc.customDays,
    joining_date: doc.joiningDate,
    active: doc.active,
    phone: doc.phone,
  };
}

export async function listStaff(activeOnly = false): Promise<StaffRow[]> {
  const filter = activeOnly ? { active: true } : {};
  const docs = await Staff.find(filter).sort({ fullName: 1 });
  return docs.map(toRow);
}

export async function getStaffOrThrow(id: string): Promise<StaffRow> {
  const doc = await Staff.findById(id);
  if (!doc) throw new NotFoundError("Staff member");
  return toRow(doc);
}

export async function createStaff(input: StaffInput, adminUserId: string): Promise<StaffRow> {
  if (input.salaryPaise < 0) throw new ValidationError("Salary cannot be negative.");
  if (input.salaryMethod === "CUSTOM" && !input.customDays) {
    throw new ValidationError("Custom salary method requires the number of days.");
  }
  const id = newId("staff");
  await Staff.create({
    _id: id,
    userId: input.userId ?? null,
    fullName: input.fullName,
    roleTitle: input.roleTitle,
    salaryPaise: input.salaryPaise,
    salaryMethod: input.salaryMethod,
    customDays: input.customDays ?? null,
    joiningDate: input.joiningDate,
    phone: input.phone ?? null,
    active: true,
    createdAt: nowIso(),
  });
  await recordAudit({ userId: adminUserId, action: "STAFF_CREATED", entityType: "staff", entityId: id, newValue: input });
  return getStaffOrThrow(id);
}

export async function updateStaff(id: string, changes: Partial<StaffInput> & { active?: boolean }, adminUserId: string): Promise<StaffRow> {
  const existing = await Staff.findById(id);
  if (!existing) throw new NotFoundError("Staff member");
  const existingRow = toRow(existing);

  if (changes.fullName !== undefined) existing.fullName = changes.fullName;
  if (changes.roleTitle !== undefined) existing.roleTitle = changes.roleTitle;
  if (changes.salaryPaise !== undefined) existing.salaryPaise = changes.salaryPaise;
  if (changes.salaryMethod !== undefined) existing.salaryMethod = changes.salaryMethod;
  if (changes.customDays !== undefined) existing.customDays = changes.customDays;
  if (changes.phone !== undefined) existing.phone = changes.phone;
  if (changes.active !== undefined) existing.active = changes.active;
  await existing.save();

  await recordAudit({ userId: adminUserId, action: "STAFF_UPDATED", entityType: "staff", entityId: id, oldValue: existingRow, newValue: changes });
  return getStaffOrThrow(id);
}

/** Daily salary expense allocation for a given calendar month, per the staff member's configured method. */
export function dailySalaryRate(staff: StaffRow, year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  switch (staff.salary_method) {
    case "CALENDAR_DAY":
      return staff.salary_paise / daysInMonth;
    case "FIXED_30":
      return staff.salary_paise / 30;
    case "WORKING_26":
      return staff.salary_paise / 26;
    case "CUSTOM":
      return staff.salary_paise / (staff.custom_days || 30);
  }
}

export async function monthlySalaryTotal(): Promise<number> {
  const active = await listStaff(true);
  return active.reduce((sum, s) => sum + s.salary_paise, 0);
}
