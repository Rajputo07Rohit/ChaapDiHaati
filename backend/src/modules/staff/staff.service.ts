import { db } from "../../db/connection";
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
  active: number;
  phone: string | null;
}

export function listStaff(activeOnly = false): StaffRow[] {
  const sql = activeOnly
    ? "SELECT * FROM staff WHERE active = 1 ORDER BY full_name"
    : "SELECT * FROM staff ORDER BY full_name";
  return db.prepare(sql).all() as StaffRow[];
}

export function getStaffOrThrow(id: string): StaffRow {
  const row = db.prepare("SELECT * FROM staff WHERE id = ?").get(id) as StaffRow | undefined;
  if (!row) throw new NotFoundError("Staff member");
  return row;
}

export function createStaff(input: StaffInput, adminUserId: string): StaffRow {
  if (input.salaryPaise < 0) throw new ValidationError("Salary cannot be negative.");
  if (input.salaryMethod === "CUSTOM" && !input.customDays) {
    throw new ValidationError("Custom salary method requires the number of days.");
  }
  const id = newId("staff");
  db.prepare(
    `INSERT INTO staff (id, user_id, full_name, role_title, salary_paise, salary_method, custom_days, joining_date, phone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId ?? null,
    input.fullName,
    input.roleTitle,
    input.salaryPaise,
    input.salaryMethod,
    input.customDays ?? null,
    input.joiningDate,
    input.phone ?? null,
    nowIso()
  );
  recordAudit({ userId: adminUserId, action: "STAFF_CREATED", entityType: "staff", entityId: id, newValue: input });
  return getStaffOrThrow(id);
}

export function updateStaff(id: string, changes: Partial<StaffInput> & { active?: boolean }, adminUserId: string): StaffRow {
  const existing = getStaffOrThrow(id);
  const merged = { ...existing, ...changes };
  db.prepare(
    `UPDATE staff SET full_name = ?, role_title = ?, salary_paise = ?, salary_method = ?, custom_days = ?, phone = ?, active = ? WHERE id = ?`
  ).run(
    merged.full_name,
    merged.role_title,
    merged.salary_paise,
    merged.salary_method,
    merged.custom_days ?? null,
    merged.phone ?? null,
    changes.active !== undefined ? (changes.active ? 1 : 0) : existing.active,
    id
  );
  recordAudit({ userId: adminUserId, action: "STAFF_UPDATED", entityType: "staff", entityId: id, oldValue: existing, newValue: changes });
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

export function monthlySalaryTotal(): number {
  return listStaff(true).reduce((sum, s) => sum + s.salary_paise, 0);
}
