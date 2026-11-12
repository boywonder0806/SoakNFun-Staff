/**
 * Publishes a dashboard file built by make.mjs as a shared report.
 *
 *   node scripts/percap-season/publish.mjs <file.html> "<title>"            # new report, prints its link
 *   node scripts/percap-season/publish.mjs <file.html> --token <token>      # replace an existing report's HTML
 */
import 'dotenv/config';
import fs from 'fs';
import pool from '../../src/db/index.js';
import { createSharedReport, updateSharedReport, getSharedReport } from '../../src/services/sharedReports.js';

const [file, ...rest] = process.argv.slice(2);
if (!file || !rest.length) { console.error('usage: publish.mjs <file.html> "<title>" | --token <token>'); process.exit(1); }
const html = fs.readFileSync(file, 'utf8');
if (rest[0] === '--token') {
  const token = rest[1], before = await getSharedReport(token);
  if (!before) { console.error('no shared report with that token'); process.exit(1); }
  const backup = `/root/shared-report-${token.slice(0, 6)}.pre-publish-${Date.now()}.html`;
  fs.writeFileSync(backup, before.html);
  await updateSharedReport(token, { html });
  console.log(`updated "${before.title}" (${before.html.length} -> ${html.length} chars); previous version backed up to ${backup}`);
} else {
  const { token } = await createSharedReport({ title: rest[0], html, createdBy: 'Isaac Joyner' });
  console.log(`published "${rest[0]}"\nhttps://analytics.bluebayoustaff.com/shared/${token}`);
}
await pool.end();
