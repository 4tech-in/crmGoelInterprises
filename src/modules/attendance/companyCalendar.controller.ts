import type { Context } from "hono";
import { CalendarDay } from "./companyCalendar.model";

// Helper to ensure all days of a year exist in CalendarDay
export const ensureCalendarForYear = async (year: number) => {
  const startOfYear = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  // Count existing days in this year
  const existingDays = await CalendarDay.find({
    date: { $gte: startOfYear, $lte: endOfYear },
  }).select("date");

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const expectedDays = isLeap ? 366 : 365;

  if (existingDays.length < expectedDays) {
    const existingDateSet = new Set(
      existingDays.map((d) => d.date.toISOString().split("T")[0])
    );

    const missingDays: any[] = [];
    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(Date.UTC(year, m, d, 0, 0, 0, 0));
        const dateStr = dt.toISOString().split("T")[0];
        if (!existingDateSet.has(dateStr)) {
          const isSunday = dt.getUTCDay() === 0;
          missingDays.push({
            date: dt,
            dayType: isSunday ? "holiday" : "working",
            isNationalHoliday: false,
            isCompanyHoliday: false,
            description: isSunday ? "Sunday" : "",
          });
        }
      }
    }

    if (missingDays.length > 0) {
      await CalendarDay.insertMany(missingDays, { ordered: false });
    }
  }
};

// Create / Generate Company Calendar
export const generateCalendar = async (c: Context) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const year = Number(body.year);
    if (!year || isNaN(year) || year < 1900) {
      return c.json({ success: false, message: "Year is required and must be a valid number" }, 400);
    }

    const startOfYear = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const existingCount = await CalendarDay.countDocuments({
      date: { $gte: startOfYear, $lte: endOfYear },
    });

    const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const expectedDays = isLeap ? 366 : 365;

    if (existingCount >= expectedDays) {
      return c.json({
        success: false,
        message: `Calendar for ${year} already exists.`,
      }, 400);
    }

    await ensureCalendarForYear(year);

    return c.json({ success: true, message: `Calendar for ${year} generated successfully.` });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
};

// Get Attendance Month wise
export const getMonthCalendar = async (c: Context) => {
  try {
    const year = parseInt(c.req.query("year") || "");
    const month = parseInt(c.req.query("month") || ""); // 1 = Jan, 12 = Dec

    if (!year || year < 1900) {
      return c.json({ success: false, message: "Valid year is required" }, 400);
    }
    if (!month || month < 1 || month > 12) {
      return c.json({ success: false, message: "Valid month (1-12) is required" }, 400);
    }

    // Auto-generate the calendar for this year if missing
    await ensureCalendarForYear(year);

    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const days = await CalendarDay.find({
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: 1 });

    return c.json({ success: true, year, month, days });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
};

// Update any date working/holiday
export const updateSingleDate = async (c: Context) => {
  try {
    const { date, dayType, isNationalHoliday, isCompanyHoliday, description } = await c.req.json();

    if (!date) {
      return c.json({ success: false, message: "Date is required" }, 400);
    }

    if (!["working", "holiday"].includes(dayType)) {
      return c.json({ success: false, message: "dayType must be 'working' or 'holiday'" }, 400);
    }

    let year: number;
    let targetDate: Date;
    let startOfDay: Date;
    let endOfDay: Date;

    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)) {
      const [y, m, d] = date.substring(0, 10).split("-").map(Number);
      if (y === undefined || m === undefined || d === undefined) {
        return c.json({ success: false, message: "Invalid date format" }, 400);
      }
      year = y;
      targetDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      endOfDay = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    } else {
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        return c.json({ success: false, message: "Invalid date format" }, 400);
      }
      year = parsed.getUTCFullYear();
      const m = parsed.getUTCMonth();
      const d = parsed.getUTCDate();
      targetDate = new Date(Date.UTC(year, m, d, 0, 0, 0, 0));
      startOfDay = new Date(Date.UTC(year, m, d, 0, 0, 0, 0));
      endOfDay = new Date(Date.UTC(year, m, d, 23, 59, 59, 999));
    }

    // Auto-generate calendar for this year if missing
    await ensureCalendarForYear(year);

    // Update the date, or upsert if not found
    const updated = await CalendarDay.findOneAndUpdate(
      { date: { $gte: startOfDay, $lte: endOfDay } },
      {
        $set: {
          date: targetDate,
          dayType,
          isNationalHoliday: !!isNationalHoliday,
          isCompanyHoliday: !!isCompanyHoliday,
          description: description || "",
        },
      },
      { returnDocument: "after", upsert: true }
    );

    return c.json({ success: true, message: "Date updated successfully", data: updated });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
};