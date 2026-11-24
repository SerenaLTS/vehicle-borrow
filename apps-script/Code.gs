/**
 * Vehicle Management MVP: Google Sheets-backed fleet list and borrow/return flow.
 * Deploy as a web app, executing as the deploying owner, restricted to your Workspace.
 * Access is checked against the Users sheet on every server call.
 */
const TAB = { vehicles: 'Vehicles', loans: 'Loans', users: 'Users' };
const HEADERS = {
  Vehicles: ['vehicle_id', 'plate_number', 'make', 'model', 'model_year', 'vehicle_type', 'status', 'color', 'vin', 'current_location', 'registration_expires_on', 'notes'],
  Loans: ['loan_id', 'vehicle_id', 'borrowed_by_email', 'driver_name', 'purpose', 'borrowed_at', 'expected_return_at', 'returned_at', 'start_odometer', 'end_odometer', 'borrow_notes', 'return_notes'],
  Users: ['email', 'display_name', 'role', 'access_status'],
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Vehicle Management');
}

function setupDatabase() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Set Script Property SHEET_ID to the Google Sheet ID before setup.');
  const ss = SpreadsheetApp.openById(id);
  Object.keys(HEADERS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const existing = sheet.getRange(1, 1, 1, HEADERS[name].length).getDisplayValues()[0];
    if (existing.every(v => !v)) sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold').setBackground('#e8eef5');
  });
  return 'Database tabs are ready.';
}

function getBootstrapData() {
  const user = requireUser_();
  return { user: user, vehicles: readRows_(TAB.vehicles).map(cleanVehicle_), loans: activeLoans_() };
}

function borrowVehicle(input) {
  const user = requireUser_();
  const vehicleId = required_(input.vehicleId, 'Choose a vehicle.');
  const driver = required_(input.driverName, 'Enter the driver name.');
  const purpose = required_(input.purpose, 'Enter the trip purpose.');
  const expected = input.expectedReturnAt ? new Date(input.expectedReturnAt) : null;
  if (!expected || isNaN(expected.getTime()) || expected <= new Date()) throw new Error('Choose a future expected return time.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const vehicles = readRows_(TAB.vehicles);
    const vehicle = vehicles.find(v => String(v.vehicle_id) === vehicleId);
    if (!vehicle) throw new Error('Vehicle not found.');
    if (vehicle.status !== 'available' || activeLoans_().some(l => String(l.vehicle_id) === vehicleId)) throw new Error('This vehicle is not currently available.');
    const id = Utilities.getUuid();
    const now = new Date();
    appendRecord_(TAB.loans, {
      loan_id: id, vehicle_id: vehicleId, borrowed_by_email: user.email, driver_name: driver,
      purpose: purpose, borrowed_at: now.toISOString(), expected_return_at: expected.toISOString(), returned_at: '',
      start_odometer: optionalNonNegative_(input.startOdometer), end_odometer: '', borrow_notes: String(input.borrowNotes || '').trim(), return_notes: ''
    });
    updateRecord_(TAB.vehicles, 'vehicle_id', vehicleId, { status: 'borrowed' });
    return getBootstrapData();
  } finally { lock.releaseLock(); }
}

function returnVehicle(input) {
  const user = requireUser_();
  const loanId = required_(input.loanId, 'Choose an active loan.');
  const endOdometer = optionalNonNegative_(input.endOdometer);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rows = readRows_(TAB.loans);
    const loan = rows.find(r => String(r.loan_id) === loanId && !r.returned_at);
    if (!loan) throw new Error('Active loan not found.');
    if (String(loan.borrowed_by_email).toLowerCase() !== user.email.toLowerCase() && user.role !== 'admin') throw new Error('Only the borrower or an admin can return this vehicle.');
    const start = loan.start_odometer === '' ? null : Number(loan.start_odometer);
    if (endOdometer !== null && start !== null && endOdometer < start) throw new Error('Return odometer cannot be less than the borrow odometer.');
    updateRecord_(TAB.loans, 'loan_id', loanId, { returned_at: new Date().toISOString(), end_odometer: endOdometer === null ? '' : endOdometer, return_notes: String(input.returnNotes || '').trim() });
    updateRecord_(TAB.vehicles, 'vehicle_id', String(loan.vehicle_id), { status: 'available' });
    return getBootstrapData();
  } finally { lock.releaseLock(); }
}

function requireUser_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) throw new Error('Google could not identify your account. Deploy within your Workspace and retry.');
  const user = readRows_(TAB.users).find(u => String(u.email).trim().toLowerCase() === email && String(u.access_status).toLowerCase() === 'approved');
  if (!user) throw new Error('Your account is not approved. Ask an admin to add you to the Users tab.');
  return { email: email, name: String(user.display_name || email), role: String(user.role || 'employee').toLowerCase() };
}

function activeLoans_() {
  const vehicles = readRows_(TAB.vehicles);
  const byId = Object.fromEntries(vehicles.map(v => [String(v.vehicle_id), cleanVehicle_(v)]));
  return readRows_(TAB.loans).filter(l => !l.returned_at).map(l => Object.assign({}, l, { vehicle: byId[String(l.vehicle_id)] || null }));
}
function cleanVehicle_(v) { return Object.assign({}, v, { vehicle_id: String(v.vehicle_id || ''), status: String(v.status || 'available').toLowerCase() }); }
function readRows_(name) {
  const sheet = database_().getSheetByName(name);
  if (!sheet) throw new Error('Missing database tab: ' + name + '. Run setupDatabase first.');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(v => v !== '' && v !== null)).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}
function appendRecord_(name, record) {
  const sheet = database_().getSheetByName(name);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(h => record[h] === undefined ? '' : record[h]));
}
function updateRecord_(name, key, value, patch) {
  const sheet = database_().getSheetByName(name);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(String);
  const keyCol = headers.indexOf(key);
  const rowIndex = rows.findIndex((row, i) => i > 0 && String(row[keyCol]) === String(value));
  if (rowIndex < 1) throw new Error('Record not found in ' + name + '.');
  Object.entries(patch).forEach(([field, val]) => {
    const col = headers.indexOf(field);
    if (col >= 0) sheet.getRange(rowIndex + 1, col + 1).setValue(val);
  });
}
function database_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Set Script Property SHEET_ID to the Google Sheet ID.');
  return SpreadsheetApp.openById(id);
}
function required_(value, message) { const result = String(value || '').trim(); if (!result) throw new Error(message); return result; }
function optionalNonNegative_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Odometer must be a non-negative number.');
  return n;
}
