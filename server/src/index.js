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

const app  = express();
const PORT = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const allowedOrigins = [
  process.env.CLIENT_URL      || 'http://localhost:5173',
  process.env.RECEPTION_URL   || 'http://localhost:5174',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

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

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'Blue Bayou Staff API' }));

// Serve React builds in production — route by Host header
if (process.env.NODE_ENV === 'production') {
  const clientBuild    = path.join(__dirname, '../../client/dist');
  const receptionBuild = path.join(__dirname, '../../reception-client/dist');

  const serveClient    = express.static(clientBuild);
  const serveReception = express.static(receptionBuild);

  app.use((req, res, next) => {
    const host = req.get('host') || '';
    host.startsWith('reception.') ? serveReception(req, res, next) : serveClient(req, res, next);
  });

  app.get('*', (req, res) => {
    const host = req.get('host') || '';
    if (host.startsWith('reception.')) {
      res.sendFile(path.join(receptionBuild, 'index.html'));
    } else {
      res.sendFile(path.join(clientBuild, 'index.html'));
    }
  });
}

app.listen(PORT, () => console.log(`Blue Bayou Staff API running on http://localhost:${PORT}`));
