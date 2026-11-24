import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outDir = fileURLToPath(new URL('./', import.meta.url));
const wb = Workbook.create();
const tabs = [
  { name: 'Vehicles', headers: ['vehicle_id','plate_number','make','model','model_year','vehicle_type','status','color','vin','current_location','registration_expires_on','notes'], widths: [190,120,120,160,100,130,140,100,180,220,180,280] },
  { name: 'Loans', headers: ['loan_id','vehicle_id','borrowed_by_email','driver_name','purpose','borrowed_at','expected_return_at','returned_at','start_odometer','end_odometer','borrow_notes','return_notes'], widths: [190,190,250,200,260,180,180,180,140,140,280,280] },
  { name: 'Users', headers: ['email','display_name','role','access_status'], widths: [250,200,120,150] },
];
for (const tab of tabs) {
  const ws = wb.worksheets.add(tab.name);
  const endCol = colName(tab.headers.length);
  ws.getRange(`A1:${endCol}1`).values = [tab.headers];
  ws.getRange(`A1:${endCol}1`).format = { fill:'#E8EEF5', font:{bold:true,color:'#172B4D',size:10}, verticalAlignment:'center', wrapText:true };
  ws.getRange(`A1:${endCol}1`).format.rowHeight = 34;
  ws.getRange(`A:${endCol}`).format.columnWidth = 21;
  tab.widths.forEach((width,i) => { ws.getRange(`${colName(i+1)}:${colName(i+1)}`).format.columnWidth = Math.min(38, Math.max(14, width/7)); });
  ws.freezePanes.freezeRows(1);
}
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(`${outDir}vehicle-management-mvp-database.xlsx`);
const review = await wb.inspect({kind:'workbook,sheet',maxChars:3000});
console.log(review.ndjson);
const preview = await wb.render({sheetName:'Vehicles',range:'A1:L8',scale:1,format:'png'});
await fs.writeFile(`${outDir}vehicles-preview.png`,new Uint8Array(await preview.arrayBuffer()));
function colName(n) { let s=''; while(n){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s; }
