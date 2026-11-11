export type SundayAttendanceRecord = {
  date: Date | string;
  status?: string | null;
  punchIn?: Date | string | null;
  punchOut?: Date | string | null;
};

export type SundayPaymentDecision = {
  sunday: Date;
  weekStart: Date;
  weekEnd: Date;
  attendanceDays: number;
  paid: boolean;
  consecutiveFiveDayWeek: number;
  reason: "six-days" | "alternating-five-days" | "insufficient-attendance" | "policy-disabled";
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const startOfUtcDay = (value: Date | string) => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const dateKey = (value: Date | string) => startOfUtcDay(value).toISOString().slice(0, 10);

const addUtcDays = (date: Date, days: number) =>
  new Date(startOfUtcDay(date).getTime() + days * DAY_IN_MS);

const attendanceCredit = (record: SundayAttendanceRecord) => {
  if (record.status === "Present") return 1;
  if (record.status === "Half-Day") return 0.5;
  if (!record.status && record.punchIn && record.punchOut) return 1;
  return 0;
};


export const calculateSundayPayments = ({
  attendanceRecords,
  periodStart,
  periodEnd,
  policyActive = true,
}: {
  attendanceRecords: SundayAttendanceRecord[];
  periodStart: Date;
  periodEnd: Date;
  policyActive?: boolean;
}): SundayPaymentDecision[] => {
  const normalizedPeriodStart = startOfUtcDay(periodStart);
  const normalizedPeriodEnd = startOfUtcDay(periodEnd);

  const creditByDate = new Map<string, number>();
  for (const record of attendanceRecords) {
    const key = dateKey(record.date);
    // Attendance has a unique user/date index. max() also prevents accidental
    // duplicate records from counting the same day more than once.
    creditByDate.set(key, Math.max(creditByDate.get(key) || 0, attendanceCredit(record)));
  }

  const earliestAttendance = attendanceRecords.length
    ? attendanceRecords.reduce((earliest, record) => {
        const recordDate = startOfUtcDay(record.date);
        return recordDate < earliest ? recordDate : earliest;
      }, startOfUtcDay(attendanceRecords[0]!.date))
    : addUtcDays(normalizedPeriodStart, -6);

  // At minimum, include the Monday preceding the first Sunday in the period.
  const calculationStart = earliestAttendance < addUtcDays(normalizedPeriodStart, -6)
    ? earliestAttendance
    : addUtcDays(normalizedPeriodStart, -6);
  const daysUntilSunday = (7 - calculationStart.getUTCDay()) % 7;
  let sunday = addUtcDays(calculationStart, daysUntilSunday);
  let consecutiveFiveDayWeeks = 0;
  const decisions: SundayPaymentDecision[] = [];

  while (sunday <= normalizedPeriodEnd) {
    const weekStart = addUtcDays(sunday, -6);
    const weekEnd = addUtcDays(sunday, -1);
    let attendanceDays = 0;

    for (let dayOffset = 0; dayOffset < 6; dayOffset += 1) {
      attendanceDays += creditByDate.get(dateKey(addUtcDays(weekStart, dayOffset))) || 0;
    }

    let paid = false;
    let reason: SundayPaymentDecision["reason"] = "insufficient-attendance";

    if (!policyActive) {
      consecutiveFiveDayWeeks = 0;
      reason = "policy-disabled";
    } else if (attendanceDays >= 6) {
      paid = true;
      consecutiveFiveDayWeeks = 0;
      reason = "six-days";
    } else if (attendanceDays >= 5) {
      consecutiveFiveDayWeeks += 1;
      paid = consecutiveFiveDayWeeks % 2 === 1;
      reason = "alternating-five-days";
    } else {
      consecutiveFiveDayWeeks = 0;
    }

    if (sunday >= normalizedPeriodStart) {
      decisions.push({
        sunday,
        weekStart,
        weekEnd,
        attendanceDays,
        paid,
        consecutiveFiveDayWeek: consecutiveFiveDayWeeks,
        reason,
      });
    }

    sunday = addUtcDays(sunday, 7);
  }

  return decisions;
};

