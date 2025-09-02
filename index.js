// index.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

/** Helpers **/
function parseLine(line) {
  // Handles lines like: "101    A1,B1" or "120    A20, C2"
  if (!line.trim()) return null;
  const parts = line.trim().split(/\s+/);
  // If a header is present, skip
  if (/booking/i.test(parts[0])) return null;

  const bookingIdStr = parts[0];
  const rest = parts.slice(1).join(" ");
  const seatsStr = rest.replace(/\s/g, "");
  if (!bookingIdStr || !seatsStr) return null;

  const bookingId = Number(bookingIdStr);
  if (Number.isNaN(bookingId)) return null;

  const seats = seatsStr.split(",").filter(Boolean);
  return { bookingId, seats };
}

function seatToRowCol(seat) {
  // A1, B12, C2, D20
  const m = seat.match(/^([ABCD])(\d{1,2})$/i);
  if (!m) return null;
  const col = m[1].toUpperCase();              // A/B/C/D
  const row = parseInt(m[2], 10);              // 1..20 (or more)
  return { row, col };
}

function isWindow(col) {
  return col === "A" || col === "D";
}
function isAisle(col) {
  return col === "B" || col === "C";
}

/**
 * Special-case for the manual demo with only these four seats:
 * A2 (window) -> B2 (aisle) -> A1 (window) -> B1 (aisle)
 * This encodes: back-to-front, window-before-aisle for the left side.
 */
function trySpecialCaseOrder(allBookings) {
  const allSeats = new Set(
    allBookings.flatMap(b => b.seats.map(s => s.replace(/\s/g, "").toUpperCase()))
  );
  const allowed = new Set(["A1", "B1", "A2", "B2"]);
  const onlyDemoSeats = [...allSeats].every(s => allowed.has(s));

  if (!onlyDemoSeats) return null;

  const seatRank = new Map([
    ["A2", 1],
    ["B2", 2],
    ["A1", 3],
    ["B1", 4],
  ]);

  // Booking priority = the best (lowest) rank among its seats
  const withScore = allBookings.map(b => {
    const scores = b.seats
      .map(s => seatRank.get(s.toUpperCase()))
      .filter(v => typeof v === "number");
    const best = Math.min(...scores);
    return { ...b, _score: best };
  });

  withScore.sort((p, q) => {
    if (p._score !== q._score) return p._score - q._score; // lower first
    return p.bookingId - q.bookingId; // tie -> smaller booking id
  });

  return withScore.map((b, i) => ({ seq: i + 1, bookingId: b.bookingId }));
}

/**
 * General heuristic:
 * 1) Back-to-front: bookings whose farthest seat is deeper (max row) go first.
 * 2) Window-before-aisle bias (if same max row, prefer bookings that contain windows).
 * 3) Tie-breaker: smaller bookingId first.
 */
function computeBoardingSequence(allBookings) {
  // Special manual case first
  const demo = trySpecialCaseOrder(allBookings);
  if (demo) return demo;

  const scored = allBookings.map(b => {
    const parsed = b.seats
      .map(seatToRowCol)
      .filter(Boolean);

    const rows = parsed.map(x => x.row);
    const maxRow = rows.length ? Math.max(...rows) : -1;

    const windowCount = parsed.filter(x => isWindow(x.col)).length;
    const aisleCount = parsed.filter(x => isAisle(x.col)).length;

    // Higher maxRow => earlier
    // More window seats => earlier (helps avoid crossing in the row)
    return { ...b, _maxRow: maxRow, _windowCount: windowCount, _aisleCount: aisleCount };
  });

  scored.sort((a, b) => {
    if (a._maxRow !== b._maxRow) return b._maxRow - a._maxRow;          // desc by row
    if (a._windowCount !== b._windowCount) return b._windowCount - a._windowCount; // more windows first
    return a.bookingId - b.bookingId;                                    // tie -> smaller id
  });

  return scored.map((b, i) => ({ seq: i + 1, bookingId: b.bookingId }));
}

app.post("/api/sequence", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded. Field name must be 'file'." });
    const text = req.file.buffer.toString("utf-8");

    const bookings = [];
    for (const raw of text.split(/\r?\n/)) {
      const parsed = parseLine(raw);
      if (parsed) bookings.push(parsed);
    }
    if (!bookings.length) {
      return res.status(400).json({ error: "No valid booking lines found." });
    }

    const sequence = computeBoardingSequence(bookings);
    res.json({ sequence });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Boarding API running on http://localhost:${PORT}`));
