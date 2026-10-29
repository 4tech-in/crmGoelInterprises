export interface AttendanceCalculationPolicy {
  shiftInTime?: string;
  shiftOutTime?: string;
  overtimeThresholdMins?: number | null;
  overtimeHourlyRate?: number;
  attendanceBufferMins?: number;
}

export const calculateAttendanceMetrics = ({
  attendanceDate,
  punchIn,
  punchOut,
  policy,
  isHoliday,
}: {
  attendanceDate: Date;
  punchIn: Date;
  punchOut: Date;
  policy: AttendanceCalculationPolicy;
  isHoliday: boolean;
}) => {
  let totalWorkedMinutes = 0;
  let overtimeHours = 0;
  let overtimePay = 0;

  if (isHoliday) {
    totalWorkedMinutes = Math.max(
      0,
      Math.round((punchOut.getTime() - punchIn.getTime()) / 60000),
    );
    overtimeHours = Number((totalWorkedMinutes / 60).toFixed(2));
    overtimePay = Number(
      (overtimeHours * (policy.overtimeHourlyRate || 0)).toFixed(2),
    );

    return { totalWorkedMinutes, overtimeHours, overtimePay };
  }

  const [shiftInHours, shiftInMinutes] = (policy.shiftInTime || "09:00")
    .split(":")
    .map(Number);
  const [shiftOutHours, shiftOutMinutes] = (policy.shiftOutTime || "18:00")
    .split(":")
    .map(Number);

  // Manual attendance stores entered clock times as UTC wall-clock values.
  // Build policy boundaries on that same basis to avoid adding the server's
  // local timezone offset (for example, an incorrect extra 5.5 hours in IST).
  const shiftInDate = new Date(Date.UTC(
    attendanceDate.getUTCFullYear(),
    attendanceDate.getUTCMonth(),
    attendanceDate.getUTCDate(),
    shiftInHours,
    shiftInMinutes,
    0,
    0,
  ));
  const shiftOutDate = new Date(Date.UTC(
    attendanceDate.getUTCFullYear(),
    attendanceDate.getUTCMonth(),
    attendanceDate.getUTCDate(),
    shiftOutHours,
    shiftOutMinutes,
    0,
    0,
  ));

  if (shiftOutDate <= shiftInDate) {
    shiftOutDate.setUTCDate(shiftOutDate.getUTCDate() + 1);
  }

  const bufferMins = policy.attendanceBufferMins || 0;
  const otThresholdMins =
    policy.overtimeThresholdMins !== undefined &&
    policy.overtimeThresholdMins !== null
      ? policy.overtimeThresholdMins
      : 30;

  const earlyLimit = shiftInDate.getTime() - bufferMins * 60000;
  const lateLimit = shiftInDate.getTime() + bufferMins * 60000;
  const effectivePunchIn =
    punchIn.getTime() >= earlyLimit && punchIn.getTime() <= lateLimit
      ? shiftInDate
      : punchIn;

  let effectivePunchOut = punchOut;
  let overtimeMins = 0;

  if (punchOut.getTime() > shiftOutDate.getTime()) {
    const extraPostShiftMins = Math.round(
      (punchOut.getTime() - shiftOutDate.getTime()) / 60000,
    );

    if (extraPostShiftMins > otThresholdMins) {
      overtimeMins = extraPostShiftMins;
    } else {
      effectivePunchOut = shiftOutDate;
    }
  }

  totalWorkedMinutes = Math.max(
    0,
    Math.round(
      (effectivePunchOut.getTime() - effectivePunchIn.getTime()) / 60000,
    ),
  );

  if (overtimeMins > 0) {
    overtimeHours = Number((overtimeMins / 60).toFixed(2));
    overtimePay = Number(
      (overtimeHours * (policy.overtimeHourlyRate || 0)).toFixed(2),
    );
  }

  return { totalWorkedMinutes, overtimeHours, overtimePay };
};
