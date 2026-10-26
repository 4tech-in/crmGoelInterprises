import type { Context } from "hono";
import { AttendancePolicy } from "./attendancePolicy.model";
import { CalendarDay } from "./companyCalendar.model";
import { Attendance } from "./attendance.model";
import { User } from "../user/user.model";
import type { JwtPayload } from "../auth/auth.type";
import { Types } from "mongoose";
import Leave from "../leaveManagement/leave.model";
import e from "express";

// --- Attendance Policy controllers Start ---

export const createAttendancePolicy = async (c: Context) => {
  try {
    const user = c.get("user") as JwtPayload;
    const body = await c.req.json();
    const policy = new AttendancePolicy({ ...body, createdBy: user.id });
    await policy.save();
    return c.json(
      { message: "Attendance policy created successfully", policy },
      201,
    );
  } catch (error: any) {
    return c.json({ message: error.message }, 500);
  }
};

export const getAttendancePolicies = async (c: Context) => {
  try {
    const policies = await AttendancePolicy.find().populate(
      "createdBy",
      "name email",
    );
    return c.json({ policies }, 200);
  } catch (error: any) {
    return c.json({ message: error.message }, 500);
  }
};

export const updateAttendancePolicy = async (c: Context) => {
  try {
    const id = c.req.param("id"); // from route /:id
    const body = await c.req.json();

    const updatedPolicy = await AttendancePolicy.findByIdAndUpdate(
      id,
      { $set: body },
      { new: true },
    );

    if (!updatedPolicy) {
      return c.json({ message: "Attendance policy not found" }, 404);
    }

    return c.json(
      {
        message: "Attendance policy updated successfully",
        policy: updatedPolicy,
      },
      200,
    );
  } catch (error: any) {
    return c.json({ message: error.message }, 500);
  }
};

export const deleteAttendancePolicy = async (c: Context) => {
  try {
    const id = c.req.param("id"); // from route /:id

    const deletedPolicy = await AttendancePolicy.findByIdAndDelete(id);

    if (!deletedPolicy) {
      return c.json({ message: "Attendance policy not found" }, 404);
    }

    return c.json({ message: "Attendance policy deleted successfully" }, 200);
  } catch (error: any) {
    return c.json({ message: error.message }, 500);
  }
};

// --- Attendance Policy controllers end ---

// --- Attendance Biometric File Upload Processing ---

// ===== HELPER: Adjust to IST (UTC+5:30) =====
const adjustIST = (dt: Date | null) => {
  if (!dt) return null;
  const newDt = new Date(dt);
  newDt.setHours(newDt.getHours() + 5);
  newDt.setMinutes(newDt.getMinutes() + 30);
  return newDt;
};

export const uploadBiometricData = async (c: Context) => {
  try {
    const formData = await c.req.parseBody();
    const file = formData["file"];

    if (!file || typeof file === "string") {
      return c.json({ message: "No valid file uploaded" }, 400);
    }

    // ===== READ FILE =====
    const buffer = Buffer.from(await (file as any).arrayBuffer());

    let text = buffer.toString("utf16le");

    if (!text.includes("\n")) {
      text = buffer.toString("utf8");
    }

    if (!text.includes("\n")) {
      text = new TextDecoder("utf-8").decode(buffer);
    }

    const lines = text.split(/\r?\n/);

    // ===== GET POLICY =====
    const policyId = formData["policyId"];

    let activePolicy = policyId
      ? await AttendancePolicy.findById(policyId)
      : await AttendancePolicy.findOne().sort({ createdAt: -1 });

    if (!activePolicy) {
      return c.json({ message: "No active attendance policy found" }, 400);
    }

    // ===== GROUP DATA BY EN NO AND DATE (IST LOCAL DATE) =====
    const map = new Map<number, Map<string, Date[]>>();

    for (const line of lines) {
      const parts = line.split("\t");

      if (parts.length < 10) continue;

      const enNoStr = parts[2]?.trim();
      const dateStr = parts[9]?.trim();

      if (!enNoStr || !dateStr) continue;

      const enNo = Number(enNoStr);

      if (isNaN(enNo)) continue;

      // ✅ Parse directly
      const dt = new Date(dateStr);

      if (isNaN(dt.getTime())) continue;

      // ✅ IMPORTANT:
      // local date use karo
      // toISOString() mat use karo
      const dateKey =
        dt.getFullYear() +
        "-" +
        String(dt.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(dt.getDate()).padStart(2, "0");

      if (!map.has(enNo)) {
        map.set(enNo, new Map());
      }

      const userDates = map.get(enNo)!;

      if (!userDates.has(dateKey)) {
        userDates.set(dateKey, []);
      }

      userDates.get(dateKey)!.push(dt);
    }

    // ===== FETCH USERS =====
    const enNosInFile = Array.from(map.keys());

    const users = await User.find({
      uniqueId: { $in: enNosInFile },
    }).populate("attendancePolicyId");

    const userMap = new Map<number, any>();
    const userPolicyMap = new Map<number, any>();
    const userCompanyMap = new Map<number, any>();

    users.forEach((u: any) => {
      userMap.set(u.uniqueId, u._id);

      userCompanyMap.set(u.uniqueId, u.companyId);

      if (u.attendancePolicyId) {
        userPolicyMap.set(u.uniqueId, u.attendancePolicyId);
      }
    });

    // ===== FETCH HOLIDAYS =====
    const allDates = Array.from(map.values()).flatMap((datesObj) =>
      Array.from(datesObj.keys()).map((k) => new Date(k)),
    );

    const startDate = new Date(Math.min(...allDates.map((d) => d.getTime())));

    const endDate = new Date(Math.max(...allDates.map((d) => d.getTime())));

    const holidays = await CalendarDay.find({
      date: { $gte: startDate, $lte: endDate },
      dayType: "holiday",
    }).select("date");

    const holidaySet = new Set(
      holidays.map((h) => {
        const d = new Date(h.date);

        return (
          d.getFullYear() +
          "-" +
          String(d.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(d.getDate()).padStart(2, "0")
        );
      }),
    );

    // ===== FETCH MANUAL ATTENDANCES TO PREVENT OVERWRITE =====
    const userIdsArray = Array.from(userMap.values());
    const manualAttendances = await Attendance.find({
      userId: { $in: userIdsArray },
      date: { $gte: startDate, $lte: endDate },
      isManual: true
    }).select("userId date");

    const manualSet = new Set(
      manualAttendances.map(a => {
        const d = new Date(a.date);
        return (
          a.userId.toString() +
          "_" +
          d.getFullYear() +
          "-" +
          String(d.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(d.getDate()).padStart(2, "0")
        );
      })
    );

    // ===== PROCESS ATTENDANCE =====
    const ops: any[] = [];

    for (const [enNo, datesObj] of map.entries()) {
      const userId = userMap.get(enNo);
      const companyId = userCompanyMap.get(enNo);

      if (!userId) continue;

      const policy: any = userPolicyMap.get(enNo) || activePolicy;

      const [shiftInHours, shiftInMinutes] = (policy.shiftInTime || "09:00")
        .split(":")
        .map(Number);

      const [shiftOutHours, shiftOutMinutes] = (policy.shiftOutTime || "18:00")
        .split(":")
        .map(Number);

      for (const [dateKey, punches] of datesObj.entries()) {
        if (manualSet.has(`${userId.toString()}_${dateKey}`)) {
          continue; // Skip processing this date as it was manually marked
        }

        punches.sort((a, b) => a.getTime() - b.getTime());

        let punchIn = punches.length > 0 ? punches[0] : null;

        // const punchOut =
        //   punches.length > 1
        //     ? punches[punches.length - 1]
        //     : null;

        //  new added section start here

        const currentUser = users.find((u: any) => u.uniqueId === enNo);

        let punchOut = punches.length > 1 ? punches[punches.length - 1] : null;

        if (
          !currentUser?.is24HourShift &&
          punches.length === 1 &&
          shiftInHours >= 5 &&
          shiftInHours <= 12
        ) {
          const firstPunch = punches[0];
          if (firstPunch) {
            const punchHour = firstPunch.getHours();
            if (punchHour >= 12) {
              punchOut = firstPunch;
              punchIn = null;
            }
          }
        }

        // ✅ 24 HOUR SHIFT LOGIC
        if (!punchOut && currentUser?.is24HourShift) {
          const nextDate = new Date(dateKey);

          nextDate.setDate(nextDate.getDate() + 1);

          const nextDateKey =
            nextDate.getFullYear() +
            "-" +
            String(nextDate.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(nextDate.getDate()).padStart(2, "0");

          const nextDayPunches = datesObj.get(nextDateKey);

          if (nextDayPunches && nextDayPunches.length > 0) {
            nextDayPunches.sort((a, b) => a.getTime() - b.getTime());

            // punchOut = nextDayPunches[0];
            punchOut = nextDayPunches.shift() || null;
          }
        }

        //  end here

        // ===== STATUS =====
        let status: "Present" | "Absent" | "Half-Day" = "Absent";

        // ===== WORKED MINUTES & OVERTIME =====
        let totalWorkedMinutes = 0;
        let overtimeHours = 0;
        let overtimePay = 0;

        const [yearStr, monthStr, dayStr] = dateKey.split("-");
        const year = Number(yearStr) || 1970;
        const month = Number(monthStr) || 1;
        const day = Number(dayStr) || 1;
        const shiftInDate = new Date(year, month - 1, day, shiftInHours, shiftInMinutes, 0, 0);
        const shiftOutDate = new Date(year, month - 1, day, shiftOutHours, shiftOutMinutes, 0, 0);

        if (shiftOutDate <= shiftInDate) {
          shiftOutDate.setDate(shiftOutDate.getDate() + 1);
        }

        const requiredMinutes =
          (shiftOutDate.getTime() - shiftInDate.getTime()) / 60000;
        const bufferMins = policy.attendanceBufferMins || 0;
        const otThresholdMins =
          policy.overtimeThresholdMins !== undefined &&
          policy.overtimeThresholdMins !== null
            ? policy.overtimeThresholdMins
            : 30;

        if (punchIn && punchOut) {
          const isHoliday = holidaySet.has(dateKey);

          if (isHoliday) {
            totalWorkedMinutes = Math.round(
              (punchOut.getTime() - punchIn.getTime()) / 60000
            );
            if (totalWorkedMinutes < 0) totalWorkedMinutes = 0;
            overtimeHours = Number((totalWorkedMinutes / 60).toFixed(2));
            overtimePay = Number(
              (overtimeHours * (policy.overtimeHourlyRate || 0)).toFixed(2)
            );
            status = "Present";
          } else {
            // ===== 1. CHECK-IN BUFFER LOGIC =====
            // Window: [shiftInDate - bufferMins, shiftInDate + bufferMins]
            // If punchIn is within this window (e.g. 8:30 AM to 9:30 AM for a 9:00 AM shift with 30m buffer),
            // working hours start at shiftInDate (9:00 AM).
            // If punchIn is earlier than (shiftInDate - bufferMins) (e.g. 8:29 AM),
            // the early buffer window does not absorb it, so working hours start from punchIn (giving 31 extra minutes).
            // If punchIn is later than (shiftInDate + bufferMins) (e.g. 9:31 AM),
            // grace period is exceeded and working hours start from punchIn.
            const earlyLimit = shiftInDate.getTime() - bufferMins * 60000;
            const lateLimit = shiftInDate.getTime() + bufferMins * 60000;
            const punchInTime = punchIn.getTime();

            let effectivePunchIn = punchIn;
            if (punchInTime >= earlyLimit && punchInTime <= lateLimit) {
              effectivePunchIn = shiftInDate;
            } else {
              effectivePunchIn = punchIn;
            }

            // ===== 2. CHECK-OUT & OVERTIME BUFFER LOGIC =====
            // If employee punches out after shiftOutDate:
            // - If extra minutes <= otThresholdMins (e.g. leaves at 6:30 PM for a 6:00 PM shift with 30m threshold):
            //   overtime is NOT granted (OT = 0), and that extra time is not added to working hours.
            // - If extra minutes > otThresholdMins (e.g. leaves at 6:32 PM):
            //   overtime threshold is exceeded, so the FULL extra duration (32 mins) is granted as OT and added to working hours.
            // If employee punches out at or before shiftOutDate:
            //   effectivePunchOut is punchOut, OT = 0.
            let effectivePunchOut = punchOut;
            let overtimeMins = 0;

            if (punchOut.getTime() > shiftOutDate.getTime()) {
              const extraPostShiftMins = Math.round(
                (punchOut.getTime() - shiftOutDate.getTime()) / 60000
              );

              if (extraPostShiftMins > otThresholdMins) {
                overtimeMins = extraPostShiftMins;
                effectivePunchOut = punchOut;
              } else {
                overtimeMins = 0;
                effectivePunchOut = shiftOutDate;
              }
            } else {
              overtimeMins = 0;
              effectivePunchOut = punchOut;
            }

            totalWorkedMinutes = Math.round(
              (effectivePunchOut.getTime() - effectivePunchIn.getTime()) / 60000
            );
            if (totalWorkedMinutes < 0) totalWorkedMinutes = 0;

            if (overtimeMins > 0) {
              overtimeHours = Number((overtimeMins / 60).toFixed(2));
              overtimePay = Number(
                (overtimeHours * (policy.overtimeHourlyRate || 0)).toFixed(2)
              );
            }

            // ===== 3. STATUS LOGIC =====
            if (totalWorkedMinutes >= requiredMinutes - bufferMins) {
              status = "Present";
            } else {
              status = "Half-Day";
            }
          }
        } else if (punchIn && !punchOut) {
          status = "Half-Day";
        }

        // ===== BULK OPS =====
        ops.push({
          updateOne: {
            filter: {
              userId,
              date: new Date(dateKey),
            },

            update: {
              $set: {
                uniqueId: enNo,
                companyId,

                // ✅ direct save
                // Mongo automatically UTC store karega
                punchIn,
                punchOut,

                status,
                totalWorkedMinutes,
                overtimeHours,
                overtimePay,
              },
            },

            upsert: true,
          },
        });
      }
    }

    if (ops.length > 0) {
      await Attendance.bulkWrite(ops);
    }

    return c.json(
      {
        message: "Attendance processed successfully",
        recordsProcessed: ops.length,
      },
      200,
    );
  } catch (error: any) {
    console.error(error);

    return c.json(
      {
        message: error.message,
      },
      500,
    );
  }
};

// ===== GET ALL ATTENDANCES WITH FILTERS & PAGINATION =====

console.log("above fully working controller with roster not hours logic");

// export const uploadBiometricData = async (c: Context) => {
//   try {
//     const formData = await c.req.parseBody();
//     const file = formData["file"];

//     if (!file || typeof file === "string") {
//       return c.json({ message: "No valid file uploaded" }, 400);
//     }

//     // ===== READ FILE =====
//     const buffer = Buffer.from(await (file as any).arrayBuffer());

//     let text = buffer.toString("utf16le");

//     if (!text.includes("\n")) {
//       text = buffer.toString("utf8");
//     }

//     if (!text.includes("\n")) {
//       text = new TextDecoder("utf-8").decode(buffer);
//     }

//     const lines = text.split(/\r?\n/);

//     // ===== GET POLICY =====
//     const policyId = formData["policyId"];

//     let activePolicy = policyId
//       ? await AttendancePolicy.findById(policyId)
//       : await AttendancePolicy.findOne().sort({ createdAt: -1 });

//     if (!activePolicy) {
//       return c.json(
//         { message: "No active attendance policy found" },
//         400
//       );
//     }

//     // ===== GROUP DATA BY EN NO AND DATE (IST LOCAL DATE) =====
//     const map = new Map<number, Map<string, Date[]>>();

//     for (const line of lines) {
//       const parts = line.split("\t");

//       if (parts.length < 10) continue;

//       const enNoStr = parts[2]?.trim();
//       const dateStr = parts[9]?.trim();

//       if (!enNoStr || !dateStr) continue;

//       const enNo = Number(enNoStr);

//       if (isNaN(enNo)) continue;

//       // ✅ Parse directly
//       const dt = new Date(dateStr);

//       if (isNaN(dt.getTime())) continue;

//       // ✅ IMPORTANT:
//       // local date use karo
//       // toISOString() mat use karo
//       const dateKey =
//         dt.getFullYear() +
//         "-" +
//         String(dt.getMonth() + 1).padStart(2, "0") +
//         "-" +
//         String(dt.getDate()).padStart(2, "0");

//       if (!map.has(enNo)) {
//         map.set(enNo, new Map());
//       }

//       const userDates = map.get(enNo)!;

//       if (!userDates.has(dateKey)) {
//         userDates.set(dateKey, []);
//       }

//       userDates.get(dateKey)!.push(dt);
//     }

//     // ===== FETCH USERS =====
//     const enNosInFile = Array.from(map.keys());

//     const users = await User.find({
//       uniqueId: { $in: enNosInFile },
//     }).populate("attendancePolicyId");

//     const userMap = new Map<number, any>();
//     const userPolicyMap = new Map<number, any>();
//     const userCompanyMap = new Map<number, any>();

//     users.forEach((u: any) => {
//       userMap.set(u.uniqueId, u._id);

//       userCompanyMap.set(u.uniqueId, u.companyId);

//       if (u.attendancePolicyId) {
//         userPolicyMap.set(u.uniqueId, u.attendancePolicyId);
//       }
//     });

//     // ===== FETCH HOLIDAYS =====
//     const allDates = Array.from(map.values()).flatMap((datesObj) =>
//       Array.from(datesObj.keys()).map((k) => new Date(k))
//     );

//     const startDate = new Date(
//       Math.min(...allDates.map((d) => d.getTime()))
//     );

//     const endDate = new Date(
//       Math.max(...allDates.map((d) => d.getTime()))
//     );

//     const holidays = await CalendarDay.find({
//       date: { $gte: startDate, $lte: endDate },
//       dayType: "holiday",
//     }).select("date");

//     const holidaySet = new Set(
//       holidays.map((h) => {
//         const d = new Date(h.date);

//         return (
//           d.getFullYear() +
//           "-" +
//           String(d.getMonth() + 1).padStart(2, "0") +
//           "-" +
//           String(d.getDate()).padStart(2, "0")
//         );
//       })
//     );

//     // ===== PROCESS ATTENDANCE =====
//     const ops: any[] = [];

//     for (const [enNo, datesObj] of map.entries()) {
//       const userId = userMap.get(enNo);
//       const companyId = userCompanyMap.get(enNo);

//       if (!userId) continue;

//       const policy: any =
//         userPolicyMap.get(enNo) || activePolicy;

//       const [shiftInHours, shiftInMinutes] = (
//         policy.shiftInTime || "09:00"
//       )
//         .split(":")
//         .map(Number);

//       const [shiftOutHours, shiftOutMinutes] = (
//         policy.shiftOutTime || "18:00"
//       )
//         .split(":")
//         .map(Number);

//       for (const [dateKey, punches] of datesObj.entries()) {
//         punches.sort((a, b) => a.getTime() - b.getTime());

//         const punchIn =
//           punches.length > 0 ? punches[0] : null;

//         // const punchOut =
//         //   punches.length > 1
//         //     ? punches[punches.length - 1]
//         //     : null;

//         //  new added section start here

//         const currentUser = users.find(
//           (u: any) => u.uniqueId === enNo
//         );

//               let punchOut =
//         punches.length > 1
//           ? punches[punches.length - 1]
//           : null;

//       // ✅ 24 HOUR SHIFT LOGIC
//       if (
//         !punchOut &&
//         currentUser?.is24HourShift
//       ) {
//         const nextDate = new Date(dateKey);

//         nextDate.setDate(nextDate.getDate() + 1);

//         const nextDateKey =
//           nextDate.getFullYear() +
//           "-" +
//           String(nextDate.getMonth() + 1).padStart(2, "0") +
//           "-" +
//           String(nextDate.getDate()).padStart(2, "0");

//         const nextDayPunches =
//           datesObj.get(nextDateKey);

//         if (
//           nextDayPunches &&
//           nextDayPunches.length > 0
//         ) {
//           nextDayPunches.sort(
//             (a, b) => a.getTime() - b.getTime()
//           );

//           // punchOut = nextDayPunches[0];
//           punchOut = nextDayPunches.shift() || null;
//         }
//       }

// //  end here

//         // ===== STATUS =====
//         let status: "Present" | "Absent" | "Half-Day" =
//           "Absent";

//         if (punchIn && punchOut) {
//           status = "Present";
//         } else if (punchIn && !punchOut) {
//           status = "Half-Day";
//         }

//         // ===== WORKED MINUTES & OVERTIME =====
//         let totalWorkedMinutes = 0;
//         let overtimeHours = 0;
//         let overtimePay = 0;

//         if (punchIn && punchOut) {
//           totalWorkedMinutes =
//             (punchOut.getTime() - punchIn.getTime()) /
//             60000;

//           // ✅ shift timing same local date pe
//           const shiftStart = new Date(punchIn);

//           shiftStart.setHours(
//             shiftInHours,
//             shiftInMinutes,
//             0,
//             0
//           );

//           const shiftEnd = new Date(punchIn);

//           shiftEnd.setHours(
//             shiftOutHours,
//             shiftOutMinutes,
//             0,
//             0
//           );

//           const isHoliday = holidaySet.has(dateKey);

//           if (!isHoliday) {
//             let extraMins = 0;

//             // Early punch in
//             const earlyMins =
//               (shiftStart.getTime() -
//                 punchIn.getTime()) /
//               60000;

//             if (
//               earlyMins > 0 &&
//               earlyMins >= policy.overtimeThresholdMins
//             ) {
//               extraMins += earlyMins;
//             }

//             // Late punch out
//             const lateMins =
//               (punchOut.getTime() -
//                 shiftEnd.getTime()) /
//               60000;

//             if (
//               lateMins > 0 &&
//               lateMins >= policy.overtimeThresholdMins
//             ) {
//               extraMins += lateMins;
//             }

//             overtimeHours = Number(
//               (extraMins / 60).toFixed(2)
//             );

//             overtimePay =
//               overtimeHours *
//               policy.overtimeHourlyRate;
//           }
//         }

//         // ===== BULK OPS =====
//         ops.push({
//           updateOne: {
//             filter: {
//               userId,
//               date: new Date(dateKey),
//             },

//             update: {
//               $set: {
//                 uniqueId: enNo,
//                 companyId,

//                 // ✅ direct save
//                 // Mongo automatically UTC store karega
//                 punchIn,
//                 punchOut,

//                 status,
//                 totalWorkedMinutes,
//                 overtimeHours,
//                 overtimePay,
//               },
//             },

//             upsert: true,
//           },
//         });
//       }
//     }

//     if (ops.length > 0) {
//       await Attendance.bulkWrite(ops);
//     }

//     return c.json(
//       {
//         message: "Attendance processed successfully",
//         recordsProcessed: ops.length,
//       },
//       200
//     );
//   } catch (error: any) {
//     console.error(error);

//     return c.json(
//       {
//         message: error.message,
//       },
//       500
//     );
//   }
// };

export const getAttendances = async (c: Context) => {
  try {
    const {
      page = "1",
      limit = "10",
      status,
      userId,
      search,
      month,
      year,
    } = c.req.query();
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);

    // ===== BASE FILTER =====
    const filter: any = {};
    if (status) filter.status = status;
    if (userId) filter.userId = new Types.ObjectId(userId as string);

    // ===== USER SPECIFIC MONTHLY ATTENDANCE =====
    if (userId && month && year) {
      const yearNum = parseInt(year as string, 10);
      const monthNum = parseInt(month as string, 10);
      if (!isNaN(yearNum) && !isNaN(monthNum)) {
        const startDate = new Date(yearNum, monthNum - 1, 1);
        const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
        filter.date = { $gte: startDate, $lte: endDate };

        const rawData = await Attendance.find(filter)
          .populate({
            path: "userId",
            select: "name email companyId otherName uniqueId",
            populate: {
              path: "companyId",
              select: "name",
            },
          })
          .sort({ date: 1 });

        const existingDateMap = new Map<string, any>();
        rawData.forEach((item) => {
          const dt = new Date(item.date);
          const y = dt.getUTCFullYear();
          const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
          const d = String(dt.getUTCDate()).padStart(2, "0");
          existingDateMap.set(`${y}-${m}-${d}`, item);
        });

        const leaves = await Leave.find({
          userId: filter.userId,
          status: "Approved",
          fromDate: { $lte: endDate },
          toDate: { $gte: startDate },
        });

        const leaveDateSet = new Set<string>();
        leaves.forEach((l) => {
          const startL = new Date(
            Math.max(new Date(l.fromDate).getTime(), startDate.getTime())
          );
          const endL = new Date(
            Math.min(new Date(l.toDate).getTime(), endDate.getTime())
          );
          for (
            let cur = new Date(startL);
            cur <= endL;
            cur.setDate(cur.getDate() + 1)
          ) {
            const y = cur.getFullYear();
            const m = String(cur.getMonth() + 1).padStart(2, "0");
            const d = String(cur.getDate()).padStart(2, "0");
            leaveDateSet.add(`${y}-${m}-${d}`);
          }
        });

        const userObj =
          rawData.length > 0 && rawData[0]
            ? rawData[0].userId
            : await User.findById(userId)
                .select("name email companyId otherName uniqueId")
                .populate("companyId", "name");

        const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
        const now = new Date();
        const isPastMonth =
          yearNum < now.getFullYear() ||
          (yearNum === now.getFullYear() && monthNum < now.getMonth() + 1);
        const isCurrentMonth =
          yearNum === now.getFullYear() && monthNum === now.getMonth() + 1;

        const maxDay = isPastMonth
          ? daysInMonth
          : isCurrentMonth
          ? now.getDate()
          : 0;

        const allRecords: any[] = [];
        for (let d = 1; d <= maxDay; d++) {
          const dateStr = `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          if (existingDateMap.has(dateStr)) {
            allRecords.push(existingDateMap.get(dateStr));
          } else if (leaveDateSet.has(dateStr)) {
            const dt = new Date(Date.UTC(yearNum, monthNum - 1, d, 0, 0, 0, 0));
            allRecords.push({
              _id: `leave_${userId}_${dateStr}`,
              userId: userObj,
              date: dt,
              status: "On Leave",
              punchIn: null,
              punchOut: null,
              totalWorkedMinutes: 0,
              overtimeHours: 0,
            });
          } else {
            const dt = new Date(Date.UTC(yearNum, monthNum - 1, d, 0, 0, 0, 0));
            allRecords.push({
              _id: `absent_${userId}_${dateStr}`,
              userId: userObj,
              date: dt,
              status: "Absent",
              punchIn: null,
              punchOut: null,
              totalWorkedMinutes: 0,
              overtimeHours: 0,
            });
          }
        }

        allRecords.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        let finalData = allRecords;
        if (status) {
          finalData = finalData.filter((item) => item.status === status);
        }

        return c.json(
          {
            data: finalData,
            total: finalData.length,
            page: pageNum,
            limit: limitNum,
          },
          200
        );
      }
    }

    if (month && year) {
      const yearNum = parseInt(year as string, 10);
      const monthNum = parseInt(month as string, 10);
      if (!isNaN(yearNum) && !isNaN(monthNum)) {
        const startDate = new Date(yearNum, monthNum - 1, 1);
        const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
        filter.date = { $gte: startDate, $lte: endDate };
      }
    } else if (year) {
      const yearNum = parseInt(year as string, 10);
      if (!isNaN(yearNum)) {
        const startDate = new Date(yearNum, 0, 1);
        const endDate = new Date(yearNum, 11, 31, 23, 59, 59, 999);
        filter.date = { $gte: startDate, $lte: endDate };
      }
    } else if (month) {
      const monthNum = parseInt(month as string, 10);
      if (!isNaN(monthNum)) {
        const currentYear = new Date().getFullYear();
        const startDate = new Date(currentYear, monthNum - 1, 1);
        const endDate = new Date(currentYear, monthNum, 0, 23, 59, 59, 999);
        filter.date = { $gte: startDate, $lte: endDate };
      }
    }

    // ===== QUERY =====
    const data = await Attendance.find(filter)
      .populate({
        path: "userId",
        select: "name email companyId",
        match: search
          ? {
              $or: [
                { name: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
              ],
            }
          : {},
        populate: {
          path: "companyId",
          select: "name",
        },
      })
      .sort({ date: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    // ⚠️ important: null user remove (because match fail ho sakta hai)
    const filteredData = data.filter((item) => item.userId !== null);

    const total = await Attendance.countDocuments(filter);

    return c.json(
      { data: filteredData, total, page: pageNum, limit: limitNum },
      200,
    );
  } catch (error: any) {
    console.error(error);
    return c.json({ message: error.message }, 500);
  }
};

// ===== GET ATTENDANCES (DEFAULT TODAY) WITH DATE FILTER + SUMMARY =====

export const getAttendancesWithSummary = async (c: Context) => {
  try {
    const {
      page = "1",
      limit = "10",
      status,
      userId,
      search,
      startDate,
      endDate,
      companyId,
    } = c.req.query();

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // ===== DATE RANGE =====
    let start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);

    let end = endDate ? new Date(endDate) : new Date(start);
    end.setHours(23, 59, 59, 999);

    // ===== USER FILTER (NO ADMIN) =====
    const baseUserFilter: any = {
      role: { $ne: "admin" },
    };

    if (companyId) {
      const companyIds = companyId
        .split(",")
        .map((id) => new Types.ObjectId(id.trim()));

      baseUserFilter.companyId = {
        $in: companyIds,
      };
    }

    // ===== SEARCH FILTER =====
    const searchFilter: any = { ...baseUserFilter };

    if (search) {
      searchFilter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
      if (!isNaN(Number(search))) {
        searchFilter.$or.push({
          uniqueId: Number(search),
        });
      }
    }

    if (userId) {
      searchFilter._id = new Types.ObjectId(userId);
    }

    // ===== ALL USERS (FOR SUMMARY) =====
    const allUsers = await User.find(baseUserFilter)
      .select(
        "_id name email companyId designation uniqueId employeeObjId otherName department",
      )
      .populate("companyId", "name")
      .populate("employeeObjId", "employeeId");

    const allUserIds = allUsers.map((u) => u._id.toString());
    const totalUsers = allUsers.length;

    // ===== FILTERED USERS (FOR DATA) =====
    const filteredUsers = await User.find(searchFilter)
      .select(
        "_id name email companyId designation uniqueId employeeObjId otherName department",
      )
      .populate("companyId", "name")
      .populate("employeeObjId", "employeeId");

    const filteredUserIds = filteredUsers.map((u) => u._id.toString());

    // ===== ATTENDANCE =====
    const attendanceDocs = await Attendance.find({
      userId: { $in: allUserIds },
      date: { $gte: start, $lte: end },
    });

    const attendanceMap = new Map();

    attendanceDocs.forEach((a) => {
      attendanceMap.set(a.userId.toString(), a);
    });

    // ===== LEAVES =====
    const leaves = await Leave.find({
      userId: { $in: allUserIds },
      status: "Approved",
      fromDate: { $lte: end },
      toDate: { $gte: start },
    });

    const leaveSet = new Set(leaves.map((l) => l.userId.toString()));

    // ===== SUMMARY =====
    let present = 0;
    let absent = 0;
    let onLeave = 0;
    let notMarked = 0;

    const finalAllUsers: any[] = [];

    for (const user of allUsers) {
      const uid = user._id.toString();
      const attendance = attendanceMap.get(uid);

      // ===== UPDATED LOGIC ONLY =====
      if (attendance) {
        const hasPunchIn = !!attendance.punchIn;
        const hasPunchOut = !!attendance.punchOut;

        if (attendance.status === "Absent" && !hasPunchIn && !hasPunchOut) {
          absent++;
          finalAllUsers.push({
            user: {
              _id: user._id,
              name: user.name,
              email: user.email,
              designation: user.designation,
              company: user.companyId,
              uniqueId: user.uniqueId,
              employeeId: (user.employeeObjId as any)?.employeeId || null,
              otherName: user.otherName,
              department: user.department,
            },
            attendance,
            status: "Absent",
          });
        } else if (
          attendance.status === "WeeklyOff" ||
          attendance.status === "Holiday"
        ) {
          // Do not increment present/absent/onLeave/notMarked
          finalAllUsers.push({
            user: {
              _id: user._id,
              name: user.name,
              email: user.email,
              designation: user.designation,
              company: user.companyId,
              uniqueId: user.uniqueId,
              employeeId: (user.employeeObjId as any)?.employeeId || null,
              otherName: user.otherName,
              department: user.department,
            },
            attendance,
            status: attendance.status,
          });
        } else if (!hasPunchIn || !hasPunchOut) {
          notMarked++;
          finalAllUsers.push({
            user: {
              _id: user._id,
              name: user.name,
              email: user.email,
              designation: user.designation,
              company: user.companyId,
              uniqueId: user.uniqueId,
              employeeId: (user.employeeObjId as any)?.employeeId || null,
              otherName: user.otherName,
              department: user.department,
            },
            attendance,
            status: "Not Marked",
          });
        } else if (
          attendance.status === "Present" ||
          (hasPunchIn && hasPunchOut)
        ) {
          present++;
          finalAllUsers.push({
            user: {
              _id: user._id,
              name: user.name,
              email: user.email,
              designation: user.designation,
              company: user.companyId,
              uniqueId: user.uniqueId,
              employeeId: (user.employeeObjId as any)?.employeeId || null,
              otherName: user.otherName,
              department: user.department,
            },
            attendance,
            status: attendance.status || "Present",
          });
        } else {
          notMarked++;
          finalAllUsers.push({
            user: {
              _id: user._id,
              name: user.name,
              email: user.email,
              designation: user.designation,
              company: user.companyId,
              uniqueId: user.uniqueId,
              employeeId: (user.employeeObjId as any)?.employeeId || null,
              otherName: user.otherName,
              department: user.department,
            },
            attendance,
            status: "Not Marked",
          });
        }
      } else if (leaveSet.has(uid)) {
        onLeave++;

        finalAllUsers.push({
          user: {
            _id: user._id,
            name: user.name,
            designation: user.designation,
            email: user.email,
            company: user.companyId,
            uniqueId: user.uniqueId,
            employeeId: (user.employeeObjId as any)?.employeeId || null,
            otherName: user.otherName,
            department: user.department,
          },
          attendance: null,
          status: "On Leave",
        });
      } else {
        absent++;

        finalAllUsers.push({
          user: {
            _id: user._id,
            name: user.name,
            designation: user.designation,
            email: user.email,
            company: user.companyId,
            uniqueId: user.uniqueId,
            employeeId: (user.employeeObjId as any)?.employeeId || null,
            otherName: user.otherName,
            department: user.department,
          },
          attendance: null,
          status: "Absent",
        });
      }
    }

    // ===== DATA FILTER =====
    let finalFiltered = finalAllUsers.filter((u) =>
      filteredUserIds.includes(u.user._id.toString()),
    );

    // if (status) {
    //   finalFiltered = finalFiltered.filter(
    //     (u) => u.status === status
    //   );
    // }

    if (status) {
      const statuses =
        status === "Present" ? ["Present", "Half-Day"] : [status];

      finalFiltered = finalFiltered.filter((u) => statuses.includes(u.status));
    }

    // ===== PAGINATION =====
    const total = finalFiltered.length;

    const paginated = finalFiltered.slice(
      (pageNum - 1) * limitNum,
      pageNum * limitNum,
    );

    // ===== RESPONSE =====
    return c.json(
      {
        summary: {
          totalUsers,
          present,
          absent,
          onLeave,
          notMarked,
        },
        data: paginated,
        total,
        page: pageNum,
        limit: limitNum,
        startDate: start,
        endDate: end,
      },
      200,
    );
  } catch (error: any) {
    console.error(error);
    return c.json({ message: error.message }, 500);
  }
};

//  ====== Update Attendance Status Of Single User

export const updateAttendanceStatus = async (c: Context) => {
  try {
    const body = await c.req.json();

    const { userId, date, status } = body;

    if (!userId || !date || !status) {
      return c.json({ message: "userId, date, status required" }, 400);
    }

    const attendance = await Attendance.findOne({
      userId,
      date: new Date(date),
    });

    if (!attendance) {
      return c.json({ message: "Attendance not found" }, 404);
    }

    // ✅ Only status update
    attendance.status = status;

    // ✅ optional logic
    if (status === "Absent") {
      attendance.punchIn = null;
      attendance.punchOut = null;
      attendance.totalWorkedMinutes = 0;
      attendance.overtimeHours = 0;
      attendance.overtimePay = 0;
    }

    if (status === "Half-Day") {
      attendance.totalWorkedMinutes = attendance.totalWorkedMinutes || 240; // example
    }

    await attendance.save();

    return c.json({
      success: true,
      message: "Status updated successfully",
      data: attendance,
    });
  } catch (error: any) {
    console.error(error);
    return c.json({ message: error.message }, 500);
  }
};

//  ====== Update Attendance Status Of Multiple User
export const updateMultipleAttendanceStatus = async (c: Context) => {
  try {
    const body = await c.req.json();

    const { userIds, date, status, punchIn, punchOut } = body;

    if (!userIds || !Array.isArray(userIds) || !date || !status) {
      return c.json({ message: "userIds, date, status required" }, 400);
    }

    // ✅ prepare update data
    const updateData: any = {
      status,
      isManual: true,
    };

    // ✅ if frontend sends punchIn/punchOut then use them
    if (punchIn) {
      updateData.punchIn = new Date(punchIn);
    }

    if (punchOut) {
      updateData.punchOut = new Date(punchOut);
    }

    if (status === "Absent") {
      updateData.punchIn = null;
      updateData.punchOut = null;
      updateData.totalWorkedMinutes = 0;
      updateData.overtimeHours = 0;
      updateData.overtimePay = 0;
    }

    if (status === "Half-Day") {
      updateData.totalWorkedMinutes = 240;
    }

    // ✅ Calculate totalWorkedMinutes if punchIn and punchOut are available
    if (updateData.punchIn && updateData.punchOut) {
      updateData.totalWorkedMinutes =
        (updateData.punchOut.getTime() - updateData.punchIn.getTime()) / 60000;
    }

    // ✅ Fetch users to get their uniqueId (required for new attendance records)
    const users = await User.find({ _id: { $in: userIds } }).select("uniqueId");
    const userMap = new Map(users.map((u) => [u._id.toString(), u.uniqueId]));

    const operations = userIds
      .map((uid: string) => {
        const uniqueId = userMap.get(uid);
        if (uniqueId === undefined) return null;

        return {
          updateOne: {
            filter: {
              userId: uid,
              date: new Date(date),
            },
            update: {
              $set: updateData,
              $setOnInsert: {
                userId: uid,
                date: new Date(date),
                uniqueId: Number(uniqueId),
              },
            },
            upsert: true,
          },
        };
      })
      .filter(Boolean) as any[];

    if (operations.length === 0) {
      return c.json({ message: "No valid users found" }, 404);
    }

    const result = await Attendance.bulkWrite(operations);

    return c.json({
      success: true,
      message: "Status updated successfully",
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
    });
  } catch (error: any) {
    console.error(error);
    return c.json({ message: error.message }, 500);
  }
};

//    Get User List For mark Manual Attendance

export const getManualAttendancePendingUsers = async (c: Context) => {
  try {
    const { date, page = "1", limit = "10", search = "" } = c.req.query();

    if (!date) {
      return c.json({ message: "date query param required" }, 400);
    }

    const pageNum = Math.max(parseInt(page as string, 10), 1);
    const limitNum = Math.max(parseInt(limit as string, 10), 1);
    const skip = (pageNum - 1) * limitNum;

    const selectedDate = new Date(date as string);

    // ===== USER FILTER =====
    const userFilter: any = {};

    if (search) {
      userFilter.$or = [
        { name: { $regex: search as string, $options: "i" } },
        { email: { $regex: search as string, $options: "i" } },
        { employeeId: { $regex: search as string, $options: "i" } },
        { uniqueId: Number(search) || -1 }, // for numeric search
      ];
    }

    // ===== GET USERS =====
    const users = await User.find(userFilter)
      .select("name email employeeId uniqueId")
      .sort({ name: 1 });

    if (users.length === 0) {
      return c.json({
        success: true,
        date,
        total: 0,
        page: pageNum,
        limit: limitNum,
        data: [],
      });
    }

    // ===== GET ATTENDANCE =====
    const userIds = users.map((u: any) => u._id);

    const attendances = await Attendance.find({
      userId: { $in: userIds },
      date: selectedDate,
    });

    const attendanceMap = new Map();

    attendances.forEach((att: any) => {
      attendanceMap.set(String(att.userId), att);
    });

    // ===== BUILD RESULT =====
    const pendingUsers = users
      .map((user: any) => {
        const record = attendanceMap.get(String(user._id));

        // No attendance record
        if (!record) {
          return {
            userId: user._id,
            name: user.name,
            email: user.email,
            employeeId: user.employeeId,
            uniqueId: user.uniqueId,
            issue: "No Punch In / No Punch Out",
            status: "Absent",
          };
        }

        let issue = "";

        if (!record.punchIn && !record.punchOut) {
          issue = "No Punch In / No Punch Out";
        } else if (!record.punchIn) {
          issue = "Missing Punch In";
        } else if (!record.punchOut) {
          issue = "Missing Punch Out";
        }

        if (issue) {
          return {
            userId: user._id,
            name: user.name,
            email: user.email,
            employeeId: user.employeeId,
            uniqueId: user.uniqueId,
            issue,
            status: record.status,
          };
        }

        return null;
      })
      .filter(Boolean);

    // ===== PAGINATION =====
    const total = pendingUsers.length;
    const paginatedData = pendingUsers.slice(skip, skip + limitNum);

    return c.json({
      success: true,
      date,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      data: paginatedData,
    });
  } catch (error: any) {
    console.error(error);
    return c.json({ message: error.message }, 500);
  }
};

//    Mark Attendance For Any Date

export const manualMarkAttendance = async (c: Context) => {
  try {
    const body = await c.req.json();

    const { userId, date, status, punchIn, punchOut } = body;

    if (!userId || !date || !status) {
      return c.json({ message: "userId, date, status required" }, 400);
    }

    // ===== CHECK USER EXISTS =====
    const user = await User.findById(userId);

    if (!user) {
      return c.json({ message: "User not found" }, 404);
    }

    // ===== VALID STATUS =====
    const allowedStatuses = [
      "Present",
      "Absent",
      "Half-Day",
      "WeeklyOff",
      "Holiday",
    ];

    if (!allowedStatuses.includes(status)) {
      return c.json({ message: "Invalid status" }, 400);
    }

    let totalWorkedMinutes = 0;

    if (punchIn && punchOut) {
      totalWorkedMinutes =
        (new Date(punchOut).getTime() - new Date(punchIn).getTime()) / 60000;
    }

    // ===== FIND EXISTING =====
    const existingAttendance = await Attendance.findOne({
      userId,
      date: new Date(date),
    });

    let attendance;

    if (existingAttendance) {
      // UPDATE ONLY
      existingAttendance.status = status;
      existingAttendance.punchIn = punchIn ? new Date(punchIn) : null;
      existingAttendance.punchOut = punchOut ? new Date(punchOut) : null;
      existingAttendance.totalWorkedMinutes = totalWorkedMinutes;
      existingAttendance.overtimeHours = 0;
      existingAttendance.overtimePay = 0;
      existingAttendance.isManual = true;

      attendance = await existingAttendance.save();
    } else {
      // CREATE NEW
      attendance = await Attendance.create({
        userId,
        uniqueId: Number(user.uniqueId),
        date: new Date(date),
        status,
        punchIn: punchIn ? new Date(punchIn) : null,
        punchOut: punchOut ? new Date(punchOut) : null,
        totalWorkedMinutes,
        overtimeHours: 0,
        overtimePay: 0,
        isManual: true,
      });
    }

    return c.json({
      success: true,
      message: existingAttendance
        ? "Attendance updated successfully"
        : "Attendance created successfully",
      data: attendance,
    });
  } catch (error: any) {
    console.error(error);
    return c.json({ message: error.message }, 500);
  }
};

// ===== MONTHLY DATE WISE ATTENDANCE COUNT =====
// query: ?year=2026&month=4

export const getAttendanceCountByMonth = async (c: Context) => {
  try {
    const { year, month } = c.req.query();

    if (!year || !month) {
      return c.json(
        { message: "year and month query params are required" },
        400,
      );
    }

    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);

    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
    const totalDays = new Date(yearNum, monthNum, 0).getDate();

    // total users
    const totalUsers = await User.countDocuments({ role: "user" });

    // attendance records
    const records = await Attendance.find({
      date: { $gte: startDate, $lte: endDate },
    }).select("date status");

    // calendar holidays
    const holidays = await CalendarDay.find({
      date: { $gte: startDate, $lte: endDate },
      dayType: "holiday",
    }).select("date dayType description");

    const holidaySet = new Set(
      holidays.map((h) => h.date.toISOString().split("T")[0]),
    );

    const map: Record<
      string,
      {
        present: number;
        halfDay: number;
        absent: number;
        isHoliday: boolean;
      }
    > = {};

    // init dates
    for (let day = 1; day <= totalDays; day++) {
      const dateObj = new Date(yearNum, monthNum - 1, day);

      const dateStr = `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      const weekDay = dateObj.getDay();
      const isWeekend = weekDay === 0 || weekDay === 6;
      const isHoliday = isWeekend || holidaySet.has(dateStr);

      map[dateStr] = {
        present: 0,
        halfDay: 0,
        absent: isHoliday ? 0 : totalUsers,
        isHoliday,
      };
    }

    // count attendance
    for (const item of records) {
      const d = new Date(item.date);

      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(d.getDate()).padStart(2, "0")}`;

      const dayData = map[dateStr];
      if (!dayData) continue;

      if (item.status === "Present") {
        dayData.present++;
        if (!dayData.isHoliday) dayData.absent--;
      }

      if (item.status === "Half-Day") {
        dayData.halfDay++;
        if (!dayData.isHoliday) dayData.absent--;
      }
    }

    const result = Object.keys(map).map((date) => ({
      date,
      present: map[date]!.present,
      halfDay: map[date]!.halfDay,
      absent: map[date]!.absent,
      isHoliday: map[date]!.isHoliday,
    }));

    return c.json(
      {
        year: yearNum,
        month: monthNum,
        totalUsers,
        data: result,
      },
      200,
    );
  } catch (error: any) {
    console.error(error);
    return c.json({ message: error.message }, 500);
  }
};

// ===== GET PARTICULAR USER MONTH-WISE ATTENDANCE =====
export const getUserMonthlyAttendance = async (c: Context) => {
  try {
    const { userId, month, year } = c.req.query();

    if (!userId || !month || !year) {
      return c.json({ message: "userId, month and year are required" }, 400);
    }

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    const data = await Attendance.find({
      userId: new Types.ObjectId(userId as string),
      date: { $gte: startDate, $lte: endDate },
    })
      .populate("userId", "name email")
      .sort({ date: 1 }); // sort by date ascending

    return c.json({ data, month, year }, 200);
  } catch (error: any) {
    console.error(error);
    return c.json({ message: error.message }, 500);
  }
};

//   DashBoard Data Api

export const getTodayAttendanceSummary = async (c: Context) => {
  try {
    const { startDate, endDate } = c.req.query();

    // ===== DATE RANGE =====
    let start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);

    let end = endDate ? new Date(endDate) : new Date(start);
    end.setHours(23, 59, 59, 999);

    // ===== USER FILTER =====
    const userFilter: any = {
      role: { $ne: "admin" },
    };

    // ===== ALL USERS =====
    const users = await User.find(userFilter).select("_id");
    const totalUsers = users.length;

    const userIds = users.map((u) => u._id.toString());

    // ===== ATTENDANCE =====
    const attendanceData = await Attendance.find({
      userId: { $in: userIds },
      date: { $gte: start, $lte: end },
    });

    const attendanceMap = new Map();

    attendanceData.forEach((a) => {
      attendanceMap.set(a.userId.toString(), a);
    });

    // ===== LEAVES =====
    const leaveData = await Leave.find({
      userId: { $in: userIds },
      status: "Approved",
      fromDate: { $lte: end },
      toDate: { $gte: start },
    });

    const leaveSet = new Set(leaveData.map((l) => l.userId.toString()));

    // ===== FINAL COUNT =====
    let present = 0;
    let absent = 0;
    let onLeave = 0;
    let notMarked = 0;

    for (const user of users) {
      const uid = user._id.toString();
      const attendance = attendanceMap.get(uid);

      if (attendance) {
        const hasPunchIn = !!attendance.punchIn;
        const hasPunchOut = !!attendance.punchOut;

        if (attendance.status === "Absent" && !hasPunchIn && !hasPunchOut) {
          absent++;
        } else if (
          attendance.status === "WeeklyOff" ||
          attendance.status === "Holiday"
        ) {
          // Do not count in present/absent/onLeave/notMarked
        } else if (!hasPunchIn || !hasPunchOut) {
          notMarked++;
        } else if (
          attendance.status === "Present" ||
          (hasPunchIn && hasPunchOut)
        ) {
          present++;
        } else {
          notMarked++;
        }
      } else if (leaveSet.has(uid)) {
        onLeave++;
      } else {
        absent++;
      }
    }

    return c.json(
      {
        startDate: start,
        endDate: end,
        totalUsers,
        present,
        absent,
        onLeave,
        notMarked,
      },
      200,
    );
  } catch (error: any) {
    console.error(error);
    return c.json({ message: error.message }, 500);
  }
};

// ===== GET MONTHLY ATTENDANCE MATRIX FOR EXPORT =====
export const getMonthlyAttendanceMatrix = async (c: Context) => {
  try {
    const { year, month, companyId } = c.req.query();

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const yearNum = year ? parseInt(year, 10) : currentYear;
    const monthNum = month ? parseInt(month, 10) : currentMonth;

    const startDate = new Date(yearNum, monthNum - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(yearNum, monthNum, 0);
    endDate.setHours(23, 59, 59, 999);
    const totalDaysInMonth = new Date(yearNum, monthNum, 0).getDate();

    // Base user filter (exclude admin)
    const userFilter: any = { role: { $ne: "admin" } };
    if (companyId && companyId !== "all") {
      const compIds = companyId
        .split(",")
        .map((id) => id.trim())
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      if (compIds.length > 0) {
        userFilter.companyId = { $in: compIds };
      }
    }

    // Fetch users
    const users = await User.find(userFilter)
      .select(
        "_id name otherName uniqueId employeeObjId designation department companyId",
      )
      .populate("companyId", "name")
      .populate("employeeObjId", "employeeId")
      .sort({ name: 1 })
      .lean();

    const userIds = users.map((u: any) => u._id);

    // Fetch attendance records for this month
    const attendanceRecords = await Attendance.find({
      userId: { $in: userIds },
      date: { $gte: startDate, $lte: endDate },
    }).lean();

    // Map: userId -> Map(dayNumber -> attendance)
    const userAttendanceMap = new Map<string, Map<number, any>>();
    attendanceRecords.forEach((att: any) => {
      const uid = att.userId.toString();
      const d = new Date(att.date);
      const day = d.getDate();
      if (!userAttendanceMap.has(uid)) {
        userAttendanceMap.set(uid, new Map());
      }
      userAttendanceMap.get(uid)!.set(day, att);
    });

    // Fetch approved leaves
    const leaves = await Leave.find({
      userId: { $in: userIds },
      status: "Approved",
      fromDate: { $lte: endDate },
      toDate: { $gte: startDate },
    }).lean();

    const userLeaveMap = new Map<string, Set<number>>();
    leaves.forEach((l: any) => {
      const uid = l.userId.toString();
      if (!userLeaveMap.has(uid)) {
        userLeaveMap.set(uid, new Set());
      }
      const from = new Date(
        Math.max(new Date(l.fromDate).getTime(), startDate.getTime()),
      );
      const to = new Date(
        Math.min(new Date(l.toDate).getTime(), endDate.getTime()),
      );
      for (let day = from.getDate(); day <= to.getDate(); day++) {
        userLeaveMap.get(uid)!.add(day);
      }
    });

    // Construct matrix for each user
    const result = users.map((u: any, idx: number) => {
      const uid = u._id.toString();
      const attMap = userAttendanceMap.get(uid) || new Map();
      const leaveDays = userLeaveMap.get(uid) || new Set();

      const days: Record<
        number,
        { status: string; punchIn?: string; punchOut?: string; hours?: number }
      > = {};
      let presentCount = 0;
      let absentCount = 0;
      let halfDayCount = 0;
      let leaveCount = 0;
      let totalOtHours = 0;
      let totalWorkedMinutes = 0;

      for (let day = 1; day <= totalDaysInMonth; day++) {
        const att = attMap.get(day);
        const onLeave = leaveDays.has(day);

        let dayStatus = "--";
        if (att) {
          dayStatus = att.status || (att.punchIn ? "Present" : "Absent");
          if (dayStatus === "Present") presentCount++;
          else if (dayStatus === "Absent") absentCount++;
          else if (dayStatus === "Half-Day") halfDayCount++;

          totalOtHours += att.overtimeHours || 0;
          totalWorkedMinutes += att.totalWorkedMinutes || 0;
        } else if (onLeave) {
          dayStatus = "On Leave";
          leaveCount++;
        }

        const formatPunchTime = (val: any) => {
          if (!val) return undefined;
          const d = new Date(val);
          if (isNaN(d.getTime())) return undefined;
          const hours = String(d.getHours()).padStart(2, "0");
          const minutes = String(d.getMinutes()).padStart(2, "0");
          return `${hours}:${minutes}`;
        };

        days[day] = {
          status: dayStatus,
          punchIn: formatPunchTime(att?.punchIn),
          punchOut: formatPunchTime(att?.punchOut),
          hours: att?.totalWorkedMinutes
            ? Number((att.totalWorkedMinutes / 60).toFixed(1))
            : 0,
        };
      }

      return {
        sNo: idx + 1,
        user: {
          _id: uid,
          name: u.otherName || u.name,
          employeeId: (u.employeeObjId as any)?.employeeId || "N/A",
          uniqueId: u.uniqueId,
          designation: u.designation || "N/A",
          department: u.department || "N/A",
          companyName: (u.companyId as any)?.name || "N/A",
        },
        days,
        summary: {
          present: presentCount,
          absent: absentCount,
          halfDay: halfDayCount,
          onLeave: leaveCount,
          totalWorkedHours: Number((totalWorkedMinutes / 60).toFixed(1)),
          overtimeHours: Number(totalOtHours.toFixed(1)),
        },
      };
    });

    return c.json(
      {
        success: true,
        year: yearNum,
        month: monthNum,
        totalDays: totalDaysInMonth,
        data: result,
      },
      200,
    );
  } catch (error: any) {
    console.error("Monthly Attendance Matrix Error:", error);
    return c.json(
      {
        success: false,
        message: error.message || "Failed to generate monthly attendance matrix",
      },
      500,
    );
  }
};
