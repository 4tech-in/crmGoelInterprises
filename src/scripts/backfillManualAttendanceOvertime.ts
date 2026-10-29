import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Attendance } from "../modules/attendance/attendance.model";
import { AttendancePolicy } from "../modules/attendance/attendancePolicy.model";
import { CalendarDay } from "../modules/attendance/companyCalendar.model";
import { User } from "../modules/user/user.model";
import { calculateAttendanceMetrics } from "../modules/attendance/attendanceCalculation";

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const applyChanges = process.argv.includes("--apply");

await connectDB();

try {
  const [records, fallbackPolicy, holidays] = await Promise.all([
    Attendance.find({
      isManual: true,
      punchIn: { $ne: null },
      punchOut: { $ne: null },
    }),
    AttendancePolicy.findOne().sort({ createdAt: -1 }),
    CalendarDay.find({ dayType: "holiday" }).select("date"),
  ]);

  const userIds = Array.from(
    new Set(records.map((record) => record.userId.toString())),
  );
  const users = await User.find({ _id: { $in: userIds } })
    .select("attendancePolicyId")
    .populate("attendancePolicyId");
  const userPolicyMap = new Map(
    users.map((user: any) => [user._id.toString(), user.attendancePolicyId]),
  );
  const holidayKeys = new Set(
    holidays.map((holiday) => toDateKey(new Date(holiday.date))),
  );

  const updates: any[] = [];
  let skippedWithoutPolicy = 0;

  for (const record of records) {
    const policy = userPolicyMap.get(record.userId.toString()) || fallbackPolicy;
    if (!policy || !record.punchIn || !record.punchOut) {
      skippedWithoutPolicy++;
      continue;
    }

    const attendanceDate = new Date(record.date);
    const metrics = calculateAttendanceMetrics({
      attendanceDate,
      punchIn: new Date(record.punchIn),
      punchOut: new Date(record.punchOut),
      policy,
      isHoliday:
        record.status === "Holiday" ||
        record.status === "WeeklyOff" ||
        attendanceDate.getDay() === 0 ||
        holidayKeys.has(toDateKey(attendanceDate)),
    });

    if (
      record.totalWorkedMinutes !== metrics.totalWorkedMinutes ||
      record.overtimeHours !== metrics.overtimeHours ||
      record.overtimePay !== metrics.overtimePay
    ) {
      updates.push({
        updateOne: {
          filter: { _id: record._id },
          update: { $set: metrics },
        },
      });
    }
  }

  if (applyChanges && updates.length > 0) {
    await Attendance.bulkWrite(updates);
  }

  console.log(
    JSON.stringify(
      {
        mode: applyChanges ? "apply" : "dry-run",
        manualRecordsChecked: records.length,
        recordsNeedingUpdate: updates.length,
        skippedWithoutPolicy,
        recordsUpdated: applyChanges ? updates.length : 0,
      },
      null,
      2,
    ),
  );
} finally {
  await mongoose.disconnect();
}
