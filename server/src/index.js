import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter from './routes/auth.js';
import scheduleRouter from './routes/schedule.js';
import messagesRouter from './routes/messages.js';
import adminRouter from './routes/admin.js';
import announcementsRouter from './routes/announcements.js';
import autoScheduleRouter from './routes/autoschedule.js';
import timeOffRouter from './routes/timeoff.js';
import shiftBoardRouter from './routes/shiftboard.js';
import netchexRouter from './routes/netchex.js';
import receptionRouter from './routes/reception.js';
import reportsRouter from './routes/reports.js';
import operationsRouter from './routes/operations.js';
import hrRouter from './routes/hr.js';
import bayoubotRouter from './routes/bayoubot.js';
import { startCallbackDigestCron } from './cron/callbackDigest.js';
import { startCrewOrderSyncCron } from './cron/crewOrderSync.js';

const app  = express();
const PORT = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const allowedOrigins = [
  process.env.CLIENT_URL      || 'http://localhost:5173',
  'https://www.bluebayoustaff.com',   // www variant — nginx serves both
  process.env.RECEPTION_URL   || 'http://localhost:5174',
  process.env.HR_URL          || 'http://localhost:5175',
  process.env.BOT_URL         || 'http://localhost:5176',
  process.env.ADMIN_URL       || 'http://localhost:5177',
  process.env.TICKETS_URL     || 'http://localhost:5178',
  'https://admin.bluebayoustaff.com',
  'https://portal.bluebayoustaff.com',
  'https://tickets.bluebayoustaff.com',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else {
      console.error(`CORS rejected origin: "${origin}" — allowed: ${allowedOrigins.join(', ')}`);
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api/auth',          authRouter);
app.use('/api/schedule',      scheduleRouter);
app.use('/api/messages',      messagesRouter);
app.use('/api/admin',         adminRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/admin/scheduler/auto-schedule', autoScheduleRouter);
app.use('/api/time-off',   timeOffRouter);
app.use('/api/shiftboard', shiftBoardRouter);
// Raw PDF body for the parse endpoint; JSON for everything else under /api/netchex
app.use('/api/netchex/parse', express.raw({ type: 'application/pdf', limit: '8mb' }));
app.use('/api/netchex',    netchexRouter);
app.use('/api/reception',  receptionRouter);
app.use('/api/reports',     reportsRouter);
app.use('/api/operations', operationsRouter);
app.use('/api/hr',         hrRouter);
app.use('/api/bayoubot',   bayoubotRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'Blue Bayou Staff API' }));

// Serve React builds in production — route by Host header
if (process.env.NODE_ENV === 'production') {
  const clientBuild    = path.join(__dirname, '../../client/dist');
  const receptionBuild = path.join(__dirname, '../../reception-client/dist');
  const hrBuild        = path.join(__dirname, '../../hr-client/dist');
  const botBuild       = path.join(__dirname, '../../bayoubot-client/dist');
  const adminBuild     = path.join(__dirname, '../../admin-client/dist');
  const ticketsBuild   = path.join(__dirname, '../../tickets-client/dist');

  const serveClient    = express.static(clientBuild);
  const serveReception = express.static(receptionBuild);
  const serveHR        = express.static(hrBuild);
  const serveBot       = express.static(botBuild);
  const serveAdmin     = express.static(adminBuild);
  const serveTickets   = express.static(ticketsBuild);

  app.use((req, res, next) => {
    const host = req.get('host') || '';
    if (host.startsWith('reception.')) return serveReception(req, res, next);
    if (host.startsWith('hr.'))        return serveHR(req, res, next);
    if (host.startsWith('bot.'))       return serveBot(req, res, next);
    if (host.startsWith('admin.'))     return serveAdmin(req, res, next);
    if (host.startsWith('tickets.'))   return serveTickets(req, res, next);
    if (host.startsWith('portal.'))    return serveClient(req, res, next);
    serveClient(req, res, next);
  });

  app.get('*', (req, res) => {
    const host = req.get('host') || '';
    if (host.startsWith('reception.')) {
      res.sendFile(path.join(receptionBuild, 'index.html'));
    } else if (host.startsWith('hr.')) {
      res.sendFile(path.join(hrBuild, 'index.html'));
    } else if (host.startsWith('bot.')) {
      res.sendFile(path.join(botBuild, 'index.html'));
    } else if (host.startsWith('admin.')) {
      res.sendFile(path.join(adminBuild, 'index.html'));
    } else if (host.startsWith('tickets.')) {
      res.sendFile(path.join(ticketsBuild, 'index.html'));
    } else {
      res.sendFile(path.join(clientBuild, 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`Blue Bayou Staff API running on http://localhost:${PORT}`);
  startCallbackDigestCron();
  startCrewOrderSyncCron();
});
