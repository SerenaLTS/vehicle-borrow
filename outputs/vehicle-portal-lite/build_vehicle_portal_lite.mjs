import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = fileURLToPath(new URL("./", import.meta.url));
const workbook = Workbook.create();

const guide = workbook.worksheets.add("Start Here");
guide.getRange("A1:D1").merge();
guide.getRange("A1").values = [["Vehicle Portal Lite · Migration Template"]];
guide.getRange("A2:D2").merge();
guide.getRange("A2").values = [["Core data structure for vehicles, users, bookings and loans"]];
guide.getRange("A4:B8").values = [
  ["Purpose", "Prepare existing portal data for a small Google Sheets + Apps Script pilot."],
  ["Scope", "Vehicles, users and access, vehicle bookings and approvals, active and historical loans."],
  ["Migration order", "Vehicles → Users → Bookings → Loans. Preserve existing IDs wherever available."],
  ["One row per record", "Do not merge cells or add subtotals inside the four data tabs."],
  ["Dates", "Keep portal timestamps as ISO 8601 with a timezone (usually UTC ending in Z). For manually entered times, use Sydney local time."],
  ["Template marker", "In row 2, replace __PASTE_DATA__ with your first real ID; never import the marker as a record."],
];
guide.getRange("A10:B12").values = [
  ["Important", "This is a data template, not yet the working web portal. The Apps Script frontend and server-side checks are a later step."],
  ["Privacy", "Do not share the workbook with all employees as an editable spreadsheet. The future portal should enforce role-based access."],
  ["Migration mapping", "Column names use stable snake_case where practical to make later import and scripting easier."],
];
guide.getRange("A1:D1").format = { fill: "#E8EEF5", font: { bold: true, size: 16, color: "#172B4D" }, verticalAlignment: "center" };
guide.getRange("A2:D2").format = { font: { size: 11, color: "#44546A" }, verticalAlignment: "center" };
guide.getRange("A4:A12").format = { font: { bold: true, color: "#172B4D" }, verticalAlignment: "top" };
guide.getRange("B4:B12").format = { wrapText: true, verticalAlignment: "top" };
guide.getRange("A1:D1").format.rowHeight = 30;
guide.getRange("A:A").format.columnWidth = 24;
guide.getRange("B:B").format.columnWidth = 100;
guide.getRange("C:D").format.columnWidth = 18;

const definitions = [
  {
    name: "Vehicles",
    table: "VehiclesTable",
    headers: ["vehicle_id", "plate_number", "make", "model", "model_year", "vehicle_type", "status", "color", "vin", "current_location", "registration_expires_on", "notes"],
    dropdowns: {
      vehicle_type: ["sedan", "suv", "ute", "truck", "display", "other"],
      status: ["available", "booked", "borrowed", "in_transit", "repair", "maintenance", "suspended", "employee_car", "deregistered", "sold", "retired"],
    },
    dateColumns: ["registration_expires_on"],
    widths: [190, 120, 120, 160, 100, 125, 140, 100, 180, 220, 180, 260],
  },
  {
    name: "Users",
    table: "UsersTable",
    headers: ["user_id", "email", "display_name", "role", "access_status", "notes"],
    dropdowns: {
      role: ["employee", "admin"],
      access_status: ["approved", "pending", "disabled"],
    },
    dateColumns: [],
    widths: [190, 250, 180, 120, 150, 280],
  },
  {
    name: "Bookings",
    table: "BookingsTable",
    headers: ["booking_id", "vehicle_id", "requested_by_user_id", "requested_by_email", "driver_type", "external_driver_name", "starts_at", "ends_at", "is_long_term", "comments", "booking_status", "approval_status", "approved_by_email", "approved_at", "created_at"],
    dropdowns: {
      driver_type: ["internal", "external"],
      is_long_term: ["no", "yes"],
      booking_status: ["draft", "pending_approval", "approved", "active", "completed", "cancelled", "rejected"],
      approval_status: ["not_required", "pending", "approved", "rejected", "cancelled"],
    },
    dateColumns: ["starts_at", "ends_at", "approved_at", "created_at"],
    widths: [190, 190, 210, 260, 130, 220, 180, 180, 110, 280, 190, 170, 250, 180, 180],
  },
  {
    name: "Loans",
    table: "LoansTable",
    headers: ["loan_id", "vehicle_id", "booking_id", "borrowed_by_user_id", "borrower_email", "driver_name", "purpose", "borrowed_at", "expected_return_at", "returned_at", "start_odometer", "end_odometer", "borrow_notes", "return_notes", "assigned_by_admin_email"],
    dropdowns: {},
    dateColumns: ["borrowed_at", "expected_return_at", "returned_at"],
    widths: [190, 190, 190, 210, 260, 220, 260, 180, 180, 180, 140, 140, 280, 280, 260],
  },
];

for (const def of definitions) {
  const sheet = workbook.worksheets.add(def.name);
  const dataEndRow = 2;
  const lastColumn = def.headers.length;
  const headerRange = sheet.getRangeByIndexes(0, 0, 1, lastColumn);
  headerRange.values = [def.headers];
  const templateRow = Array(def.headers.length).fill(null);
  templateRow[0] = "__PASTE_DATA__";
  sheet.getRangeByIndexes(1, 0, 1, def.headers.length).values = [templateRow];
  headerRange.format = {
    fill: "#E8EEF5",
    font: { bold: true, color: "#172B4D", size: 10 },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: "#D9E0E8" },
  };
  sheet.getRangeByIndexes(0, 0, dataEndRow, lastColumn).format.verticalAlignment = "center";
  sheet.getRangeByIndexes(1, 0, 1, lastColumn).format.numberFormat = "@";
  for (let col = 0; col < def.headers.length; col += 1) {
    sheet.getRangeByIndexes(0, col, dataEndRow, 1).format.columnWidth = Math.max(12, Math.min(34, def.widths[col] / 7));
  }
  for (const colName of def.dateColumns) {
    const columnIndex = def.headers.indexOf(colName);
    sheet.getRangeByIndexes(1, columnIndex, 1, 1).format.numberFormat = "yyyy-mm-dd hh:mm";
  }
  for (const [colName, options] of Object.entries(def.dropdowns)) {
    const columnIndex = def.headers.indexOf(colName);
    sheet.getRangeByIndexes(1, columnIndex, 1, 1).dataValidation = { rule: { type: "list", values: options } };
  }
  sheet.getRangeByIndexes(0, 0, 1, lastColumn).format.rowHeight = 36;
  sheet.freezePanes.freezeRows(1);
  sheet.tables.add(`A1:${String.fromCharCode(64 + lastColumn)}2`, true, def.table);
}

workbook.recalculate();

const summary = await workbook.inspect({ kind: "workbook,sheet,table", maxChars: 6000, tableMaxRows: 3, tableMaxCols: 6 });
console.log(summary.ndjson);
for (const def of definitions) {
  const preview = await workbook.render({ sheetName: def.name, range: `A1:${String.fromCharCode(64 + def.headers.length)}2`, scale: 1, format: "png" });
  const bytes = new Uint8Array(await preview.arrayBuffer());
  await fs.writeFile(`${outputDir}${def.name.toLowerCase()}_preview.png`, bytes);
}
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(`${outputDir}vehicle-portal-lite.xlsx`);
