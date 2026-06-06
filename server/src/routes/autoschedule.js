import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/admin/scheduler/auto-schedule
// body: { weekStart, departments, dailyCoverage, minHours, maxHours }
router.post('/', requireAdmin, async (req, res) => {
  const {
    weekStart,
    departments = ['Aquatics', 'Food & Beverage', 'Guest Services', 'Cleaning Crew'],
    dailyCoverage = {},   // { 'Aquatics': 2, 'Food & Beverage': 2, ... }
    minHours = 16,
    maxHours = 40,
    shiftStart = '09:00',
    shiftEnd = '17:00',
  } = req.body;

  if (!weekStart) return res.status(400).json({ error: 'weekStart is required.' });

  // Managers can only auto-schedule their own departments
  const managerDepts = req.user.role === 'sysadmin' ? null : (req.user.departments ?? []);
  if (managerDepts) {
    const forbidden = departments.filter(d => !managerDepts.includes(d));
    if (forbidden.length) {
      return res.status(403).json({ error: `You do not have access to: ${forbidden.join(', ')}` });
    }
  }

  try {
    // Build the 7-day window
    const base = new Date(weekStart + 'T00:00:00');
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toISOString().slice(0, 10);
    });

    // Fetch active employees — filter to manager's departments if applicable
    const { rows: employees } = managerDepts
      ? await pool.query(
          `SELECT id, name, department, departments, position
           FROM employees WHERE is_active = true AND role = 'crew_member' AND departments && $1::text[]
           ORDER BY name`,
          [managerDepts]
        )
      : await pool.query(
          `SELECT id, name, department, departments, position
           FROM employees WHERE is_active = true AND role = 'crew_member'
           ORDER BY name`
        );

    // Fetch any existing draft shifts for this week (so Claude avoids duplicating)
    const { rows: existing } = await pool.query(
      `SELECT employee_id, date::text FROM draft_shifts WHERE date = ANY($1::date[])`,
      [days]
    );

    // Fetch positions with scheduling notes for these departments
    const { rows: positions } = await pool.query(
      `SELECT department, name, description AS "schedulingNotes"
       FROM department_roles
       WHERE type = 'position' AND department = ANY($1::text[])
       ORDER BY department, sort_order`,
      [departments]
    );

    const existingMap = existing.map(s => `${s.employee_id} on ${s.date}`).join(', ') || 'none';

    // Build per-department position list
    const positionsByDept = {};
    for (const p of positions) {
      if (!positionsByDept[p.department]) positionsByDept[p.department] = [];
      positionsByDept[p.department].push(p);
    }

    const positionLines = departments.map(d => {
      const deptPositions = positionsByDept[d];
      if (deptPositions?.length) {
        const lines = deptPositions.map(p => {
          const notes = p.schedulingNotes?.trim();
          return notes
            ? `    - ${p.name}\n      SCHEDULING NOTES: ${notes}`
            : `    - ${p.name}`;
        }).join('\n');
        return `${d}:\n${lines}`;
      }
      return `${d}: ${dailyCoverage[d] ?? 2} staff/day (no positions defined — distribute evenly)`;
    }).join('\n\n');

    const prompt = `You are a professional waterpark scheduler. Generate a weekly shift schedule.

WEEK: ${days[0]} to ${days[6]} (Mon–Sun)

EMPLOYEES:
${employees.map(e => `- ID ${e.id}: ${e.name}, departments: ${(e.departments || [e.department]).join(', ')}, position: ${e.position}`).join('\n')}

POSITIONS TO FILL (each position = exactly 1 slot per day, every day of the week):
${positionLines}

SCHEDULING RULES:
- Each employee works ${minHours}–${maxHours} hours this week
- Default shift window: ${shiftStart}–${shiftEnd}. Adjust per position if scheduling notes dictate different times
- Max 5 working days per employee
- Only assign employees to departments listed in their departments array
- Spread shifts across the week — avoid giving everyone the same days off
- Fill every position every day; use the exact position names above in the "position" field
- Existing draft shifts (do not duplicate): ${existingMap}

CRITICAL — SCHEDULING NOTES ARE HARD CONSTRAINTS:
Each position may have SCHEDULING NOTES. These are operational requirements written by management that you MUST follow precisely:
- If notes say a shift starts at a specific time, use that exact start time
- If notes say to cut the position early or that demand drops, shorten the shift end time accordingly
- If notes describe demand patterns (busier mornings, slower afternoons), adjust times to match
- If notes say the position isn't needed certain days, skip those days
Treat every scheduling note as a binding instruction, not a suggestion.

Return ONLY a valid JSON object with this exact shape, no other text:
{
  "shifts": [
    {
      "employeeId": 1,
      "date": "2026-05-26",
      "start": "09:00",
      "end": "17:00",
      "department": "Aquatics",
      "position": "Tower 1",
      "location": "",
      "notes": ""
    }
  ],
  "summary": "A 2–4 sentence paragraph explaining your overall scheduling decisions for this week — how you distributed hours, any positions you could not fully fill and why (e.g. not enough staff, department constraints), any employees who received fewer or more shifts than ideal, and any other notable trade-offs or assumptions you made."
}`;

    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();

    // Extract JSON object from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'AI returned an unexpected format. Try again.' });

    const parsed   = JSON.parse(jsonMatch[0]);
    const schedule = Array.isArray(parsed) ? parsed : (parsed.shifts ?? []);
    const summary  = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';

    // Validate and insert each shift
    const inserted = [];
    for (const s of schedule) {
      if (!s.employeeId || !s.date || !s.start || !s.end || !s.department) continue;
      // Verify employee exists and belongs to this department
      const emp = employees.find(e => e.id === s.employeeId);
      if (!emp) continue;
      const empDepts = emp.departments || [emp.department];
      if (!empDepts.includes(s.department)) continue;
      // Verify date is within the week
      if (!days.includes(s.date)) continue;

      const { rows } = await pool.query(
        `INSERT INTO draft_shifts (employee_id, date, start_time, end_time, department, position, location, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING
         RETURNING id, employee_id AS "employeeId", date::text, start_time AS start,
                   end_time AS end, department, position, location, COALESCE(notes,'') AS notes`,
        [s.employeeId, s.date, s.start, s.end, s.department,
         s.position || emp.position || '', s.location || '', s.notes || '']
      );
      if (rows[0]) inserted.push(rows[0]);
    }

    res.json({ generated: inserted.length, shifts: inserted, summary });
  } catch (err) {
    console.error('Auto-schedule error:', err.message);
    res.status(500).json({ error: 'Auto-schedule failed: ' + err.message });
  }
});

export default router;
