import type { Context } from "hono";
import { EmployeeSalary } from "./employeeSalary.model";
import { PayrollPolicy } from "../payroll/payrollPolicy.model";
import { Attendance } from "../attendance/attendance.model";
import mongoose from "mongoose";
import { Types } from "mongoose";
import { CalendarDay } from "../attendance/companyCalendar.model";
import { User } from "../user/user.model";
import Company from "../company/company.model";


//  add employee salary
export const addEmployeeSalary = async (c: Context) => {
  try {
    const body = await c.req.json();
    const { userId, userIds, hourly, monthly, daily, hourlyRate, monthlySalary, dailyRate } = body;

    const targetUserIds: string[] = Array.isArray(userIds)
      ? userIds
      : Array.isArray(userId)
        ? userId
        : userId
          ? [userId]
          : [];

    // ✅ Basic validations
    if (targetUserIds.length === 0) return c.json({ message: "At least one employee must be selected" }, 400);
    if (!hourly && !monthly && !daily)
      return c.json({ message: "At least one salary type must be true" }, 400);

    const validIds = targetUserIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0)
      return c.json({ message: "No valid employee IDs provided" }, 400);

    const salaryData = {
      hourly: !!hourly,
      monthly: !!monthly,
      daily: !!daily,
      hourlyRate: hourly ? hourlyRate : undefined,
      monthlySalary: monthly ? monthlySalary : undefined,
      dailyRate: daily ? dailyRate : undefined,
    };

    // Upsert salary for all target employees so existing records are updated and new ones created
    const savedSalaries = await Promise.all(
      validIds.map(async (uId) => {
        return (EmployeeSalary as any).findOneAndUpdate(
          { userId: new mongoose.Types.ObjectId(uId) },
          { $set: { ...salaryData, userId: new mongoose.Types.ObjectId(uId) } },
          { upsert: true, new: true, runValidators: true }
        );
      })
    );

    return c.json(
      {
        message:
          targetUserIds.length > 1
            ? `Successfully configured salary for ${savedSalaries.length} employee(s)`
            : "Employee salary configured successfully",
        data: targetUserIds.length === 1 ? savedSalaries[0] : savedSalaries,
      },
      201
    );
  } catch (err: any) {
    console.error(err);
    return c.json({ message: "Internal server error", error: err.message }, 500);
  }
};



// ===== GET ALL EMPLOYEE SALARIES =====
export const getEmployeeSalaries = async (c: Context) => {
  try {
    const {
      page = "1",
      limit = "10",
      search = "",
      userId,
      salaryType,
    } = c.req.query();

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};

    // ===== USER ID FILTER =====
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      filter.userId = new mongoose.Types.ObjectId(userId);
    }

    // ===== SALARY TYPE FILTER =====
    if (salaryType === "hourly") filter.hourly = true;
    if (salaryType === "monthly") filter.monthly = true;
    if (salaryType === "daily") filter.daily = true;

    // ===== SEARCH BY USER NAME / EMAIL =====
    if (search) {
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      const userIds = users.map((u) => u._id);

      filter.userId = { $in: userIds };
    }

    // ===== GET DATA =====
    const data = await EmployeeSalary.find(filter)
      .populate("userId", "name email otherName department uniqueId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);


    const total = await EmployeeSalary.countDocuments(filter);

    return c.json(
      {
        message: "Employee salaries fetched successfully",
        data,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      200
    );
  } catch (err: any) {
    console.error(err);
    return c.json(
      {
        message: "Internal server error",
        error: err.message,
      },
      500
    );
  }
};


//  update employee salary
export const updateEmployeeSalary = async (c: Context) => {
  try {
    const userId = c.req.param("userId");
    const body = await c.req.json();

    const {
      hourly,
      monthly,
      daily,
      hourlyRate,
      monthlySalary,
      dailyRate,
    } = body;

    // ===== VALIDATION =====
    if (!userId) {
      return c.json({ message: "userId is required" }, 400);
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return c.json({ message: "Invalid userId" }, 400);
    }

    if (!hourly && !monthly && !daily) {
      return c.json(
        { message: "At least one salary type must be true" },
        400
      );
    }

    // ===== UPDATE DATA =====
    const updateData = {
      hourly: !!hourly,
      monthly: !!monthly,
      daily: !!daily,
      hourlyRate: hourlyRate ?? undefined,
      monthlySalary: monthlySalary ?? undefined,
      dailyRate: dailyRate ?? undefined,
    };

    const salary = await EmployeeSalary.findOneAndUpdate(
      {
        userId: new mongoose.Types.ObjectId(userId),
      } as any,
      { $set: updateData },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return c.json(
      {
        message: "Employee salary updated successfully",
        data: salary,
      },
      200
    );
  } catch (err: any) {
    console.error(err);
    return c.json(
      {
        message: "Internal server error",
        error: err.message,
      },
      500
    );
  }
};




// ===== DELETE EMPLOYEE SALARY =====
export const deleteEmployeeSalary = async (c: Context) => {
  try {
    const userId = c.req.param("userId") || c.req.query("userId");

    // ===== VALIDATION =====
    if (!userId) {
      return c.json({ message: "userId is required" }, 400);
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return c.json({ message: "Invalid userId" }, 400);
    }

    const deletedSalary = await EmployeeSalary.findOneAndDelete(
      {
        userId: new mongoose.Types.ObjectId(userId),
      } as any
    );

    if (!deletedSalary) {
      return c.json(
        { message: "Salary record not found for this employee" },
        404
      );
    }

    return c.json(
      {
        message: "Employee salary deleted successfully",
        data: deletedSalary,
      },
      200
    );
  } catch (err: any) {
    console.error(err);
    return c.json(
      {
        message: "Internal server error",
        error: err.message,
      },
      500
    );
  }
};





// export const calculateEmployeePayroll = async (c: Context) => {
//   try {
//     const employeeId = c.req.query("employeeId");
//     const month = c.req.query("month"); // format: YYYY-MM

//     if (!employeeId || !month) {
//       return c.json({ message: "employeeId and month are required" }, 400);
//     }
//     if (!mongoose.Types.ObjectId.isValid(employeeId)) {
//       return c.json({ message: "Invalid employeeId" }, 400);
//     }

//     const [year, monthNum] = month.split("-");
//     const startDate = new Date(Number(year), Number(monthNum) - 1, 1);
//     const endDate = new Date(Number(year), Number(monthNum), 0);
//     const employeeObjectId = new mongoose.Types.ObjectId(employeeId);

//     const salary = await EmployeeSalary.findOne({ userId: employeeObjectId as any }).populate("userId", "name email");
    
//     if (!salary) return c.json({ message: "Salary info not found" }, 404);

//     // ✅ Extract employeeName safely
//     const employeeName = salary?.userId && "name" in salary.userId ? salary.userId.name : "Unknown";

//     const payrollPolicy = await PayrollPolicy.findOne({ createdBy: employeeId }).sort({ createdAt: -1 });
//     if (!payrollPolicy) return c.json({ message: "Payroll policy not found" }, 404);

//     const attendanceRecords = await Attendance.find({
//       userId: employeeObjectId,
//       date: { $gte: startDate, $lte: endDate },
//     });

//     const calendarDays = await CalendarDay.find({ date: { $gte: startDate, $lte: endDate } });

//     let totalWorkedMinutes = 0;
//     let totalOvertimeHours = 0;
//     let overtimePayFromDB = 0;

//     attendanceRecords.forEach((r) => {
//       totalWorkedMinutes += r.totalWorkedMinutes || 0;
//       totalOvertimeHours += r.overtimeHours || 0;
//       overtimePayFromDB += r.overtimePay || 0;
//     });

//     let basePay = 0;
//     let totalPaidDays = 0;
//     let payrollDetails: Record<string, number> = {};

//     // ============================
//     // 🟢 HOURLY
//     // ============================
//     if (salary.hourly) {
//       const totalHours = totalWorkedMinutes / 60;
//       basePay = totalHours * (salary.hourlyRate || 0);
//     }

//     // ============================
//     // 🟢 DAILY
//     // ============================
//     else if (salary.daily) {
//       const workingDays = calendarDays.filter(
//         (d) => d.dayType === "working" && !d.isCompanyHoliday && !d.isNationalHoliday
//       );
//       for (const day of workingDays) {
//         const record = attendanceRecords.find((r) => r.date.toDateString() === day.date.toDateString());
//         if (!record) continue;

//         if (record.status === "Present" && record.punchIn && record.punchOut) totalPaidDays += 1;
//         else if (record.status === "Half-Day" && record.punchIn && record.punchOut) totalPaidDays += 0.5;
//       }
//       basePay = totalPaidDays * (salary.dailyRate || 0);
//     }

//     // ============================
//     // 🟢 MONTHLY (WITH PAYROLL POLICY)
//     // ============================
//     else if (salary.monthly) {
//       const workingDays = calendarDays.filter(
//         (d) => d.dayType === "working" && !d.isCompanyHoliday && !d.isNationalHoliday
//       );
//       const totalWorkingDays = workingDays.length;

//       // split month into weeks for sunday policy
//       const weeks: any[] = [];
//       let current = new Date(startDate);
//       while (current <= endDate) {
//         const weekStart = new Date(current);
//         const weekEnd = new Date(current);
//         weekEnd.setDate(weekEnd.getDate() + 6);
//         weeks.push({ start: new Date(weekStart), end: weekEnd > endDate ? endDate : weekEnd });
//         current.setDate(current.getDate() + 7);
//       }

//       let lastWeekWasFiveDays = false;
//       for (const week of weeks) {
//         const weekDays = workingDays.filter((d) => d.date >= week.start && d.date <= week.end);

//         let daysWorked = 0;
//         for (const day of weekDays) {
//           const record = attendanceRecords.find((r) => r.date.toDateString() === day.date.toDateString());
//           if (!record) continue;

//           if (record.status === "Present" && record.punchIn && record.punchOut) daysWorked += 1;
//           else if (record.status === "Half-Day" && record.punchIn && record.punchOut) daysWorked += 0.5;
//         }

//         let isSundayPaid = false;
//         if (daysWorked === 6) {
//           isSundayPaid = true;
//           lastWeekWasFiveDays = false;
//         } else if (daysWorked === 5) {
//           if (!lastWeekWasFiveDays) {
//             isSundayPaid = true;
//             lastWeekWasFiveDays = true;
//           } else {
//             isSundayPaid = false;
//             lastWeekWasFiveDays = false;
//           }
//         } else {
//           isSundayPaid = false;
//           lastWeekWasFiveDays = false;
//         }

//         totalPaidDays += daysWorked;
//         if (isSundayPaid) {
//           const sunday = calendarDays.find((d) => d.date >= week.start && d.date <= week.end && d.date.getDay() === 0);
//           if (sunday) totalPaidDays += 1;
//         }
//       }

//       // Gross Pay proportional to worked days
//       const workedRatio = totalWorkingDays === 0 ? 0 : totalPaidDays / totalWorkingDays;
//       const grossPay = (salary.monthlySalary || 0) * workedRatio;

//       // Payroll Policy Breakdown
//       const policy = payrollPolicy.heads || {};
//       const allowances = {
//         basic: (policy.basic / 100) * grossPay || 0,
//         hra: (policy.hra / 100) * grossPay || 0,
//         conveyance: (policy.conveyance / 100) * grossPay || 0,
//       };

//       const deductions = {
//         pfEmployee: (policy.pfEmployee / 100) * grossPay || 0,
//         esiEmployee: (policy.esiEmployee / 100) * grossPay || 0,
//         lwfEmployee: (policy.lwfEmployee / 100) * grossPay || 0,
//       };

//       basePay =
//         Object.values(allowances).reduce((a, b) => a + b, 0) -
//         Object.values(deductions).reduce((a, b) => a + b, 0);

//       // ============================
//       // OVERTIME
//       // ============================
//       const overtimeRate = policy.overtimeHourlyRate || 0;
//       const overtimePay = totalOvertimeHours * overtimeRate;

//       const netPay = basePay + overtimePay;

//       // Save details for response
//       payrollDetails = { ...allowances, ...deductions };

//       // Assign back to outer scope
//       basePay = Number(basePay.toFixed(2));
//       totalOvertimeHours = Number(totalOvertimeHours.toFixed(2));
//       totalPaidDays = Number(totalPaidDays.toFixed(2));
//       payrollDetails = Object.fromEntries(
//         Object.entries(payrollDetails).map(([k, v]) => [k, Number(v.toFixed(2))])
//       );

//       return c.json(
//         {
//           employeeId,
//           employeeName,
//           month,
//           totalWorkedMinutes: Number(totalWorkedMinutes.toFixed(2)),
//           totalOvertimeHours,
//           totalPaidDays,
//           basePay,
//           overtimePay: Number(overtimePay.toFixed(2)),
//           netPay: Number(netPay.toFixed(2)),
//           payrollDetails,
//         },
//         200
//       );
//     }

//     // ============================
//     // OVERTIME for hourly/daily handled outside monthly
//     // ============================
//     const overtimeRate = payrollPolicy.heads?.overtimeHourlyRate || 0;
//     const overtimePay = totalOvertimeHours * overtimeRate;
//     const netPay = basePay + overtimePay;

//     const round = (num: number) => Number(num.toFixed(2));

//     return c.json(
//       {
//         employeeId,
//         employeeName,
//         month,
//         totalWorkedMinutes: round(totalWorkedMinutes),
//         totalOvertimeHours: round(totalOvertimeHours),
//         totalPaidDays: round(totalPaidDays),
//         basePay: round(basePay),
//         overtimePay: round(overtimePay),
//         netPay: round(netPay),
//         payrollDetails,
//       },
//       200
//     );
//   } catch (err: any) {
//     console.error(err);
//     return c.json({ message: err.message || "Internal Server Error" }, 500);
//   }
// };




// Helper to generate calendar days if not seeded in DB or check calendar
const getMonthCalendarDays = async (startDate: Date, endDate: Date, year: number, monthNum: number) => {
  let calendarDays = await CalendarDay.find({ date: { $gte: startDate, $lte: endDate } }).sort({ date: 1 });
  if (calendarDays.length === 0) {
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const generated: any[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(Date.UTC(year, monthNum - 1, d));
      const isSunday = dt.getUTCDay() === 0;
      generated.push({
        date: dt,
        dayType: isSunday ? "holiday" : "working",
        isCompanyHoliday: false,
        isNationalHoliday: false,
      });
    }
    calendarDays = generated;
  }
  return calendarDays;
};

// Unified payroll computation engine with attendance and calendar reconciliation
const computePayrollDetails = ({
  salary,
  user,
  attendanceRecords,
  calendarDays,
  startDate,
  endDate,
}: {
  salary: any;
  user: any;
  attendanceRecords: any[];
  calendarDays: any[];
  startDate: Date;
  endDate: Date;
}) => {
  const round = (num: number) => Number((num || 0).toFixed(2));
  const employeeId = user._id;
  const employeeName = user.otherName || user.name || "Unknown";
  const employeeCode = user.employeeId || "";
  const payrollPolicy = user?.payrollPolicyId;

  const toDateStr = (date: Date | string) => {
    const d = new Date(date);
    return d.toISOString().slice(0, 10);
  };

  // Calendar breakdown
  const holidays = calendarDays.filter(
    (d) =>
      d.isCompanyHoliday ||
      d.isNationalHoliday ||
      (d.dayType === "holiday" && new Date(d.date).getUTCDay() !== 0)
  );

  const weeklyOffDays = calendarDays.filter(
    (d) => new Date(d.date).getUTCDay() === 0 || d.dayType === "weekly_off"
  );

  const workingDays = calendarDays.filter(
    (d) =>
      (d.dayType === "working" || !d.dayType) &&
      !d.isCompanyHoliday &&
      !d.isNationalHoliday &&
      new Date(d.date).getUTCDay() !== 0
  );

  const totalWorkingDays = workingDays.length > 0 ? workingDays.length : 26;

  // Attendance metrics
  let totalWorkedMinutes = 0;
  let totalOvertimeHours = 0;
  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;

  attendanceRecords.forEach((r) => {
    totalWorkedMinutes += r.totalWorkedMinutes || 0;
    totalOvertimeHours += r.overtimeHours || 0;

    if (r.status === "Present" || (!r.status && r.punchIn && r.punchOut)) {
      presentDays += 1;
    } else if (r.status === "Half-Day") {
      halfDays += 1;
    } else if (r.status === "Absent") {
      absentDays += 1;
    }
  });

  let basePay = 0;
  let totalPaidDays = 0;
  let paidSundaysCount = 0;
  let payrollDetails: Record<string, number> = {};
  let salaryType = "monthly";
  let rate = salary.monthlySalary || 0;
  let grossPay = 0;

  if (salary.hourly) {
    salaryType = "hourly";
    rate = salary.hourlyRate || 0;
    const totalHours = totalWorkedMinutes / 60;
    basePay = totalHours * (salary.hourlyRate || 0);
    grossPay = basePay;
    totalPaidDays = presentDays + halfDays * 0.5;
  } else if (salary.daily) {
    salaryType = "daily";
    rate = salary.dailyRate || 0;
    totalPaidDays = presentDays + halfDays * 0.5;
    basePay = totalPaidDays * (salary.dailyRate || 0);
    grossPay = basePay;
  } else {
    // MONTHLY
    salaryType = "monthly";
    rate = salary.monthlySalary || 0;

    // Split month into weekly periods for Sunday weekly off policy
    const weeks: any[] = [];
    let current = new Date(startDate);
    while (current <= endDate) {
      const weekStart = new Date(current);
      const weekEnd = new Date(current);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weeks.push({ start: new Date(weekStart), end: weekEnd > endDate ? endDate : weekEnd });
      current.setDate(current.getDate() + 7);
    }

    let lastWeekWasFiveDays = false;
    for (const week of weeks) {
      const weekCalendarDays = calendarDays.filter(
        (d) => new Date(d.date) >= week.start && new Date(d.date) <= week.end
      );

      let daysWorkedInWeek = 0;
      for (const day of weekCalendarDays) {
        const dayStr = toDateStr(day.date);
        const record = attendanceRecords.find((r) => toDateStr(r.date) === dayStr);
        if (!record) continue;

        if (record.status === "Present" || (!record.status && record.punchIn && record.punchOut)) {
          daysWorkedInWeek += 1;
        } else if (record.status === "Half-Day") {
          daysWorkedInWeek += 0.5;
        }
      }

      // Sunday policy calculation: 6 working days in week grants paid Sunday; 5 days can alternate
      let isSundayPaid = false;
      if (payrollPolicy?.sundayPolicyActive !== false) {
        if (daysWorkedInWeek >= 6) {
          isSundayPaid = true;
          lastWeekWasFiveDays = false;
        } else if (daysWorkedInWeek >= 5) {
          if (!lastWeekWasFiveDays) {
            isSundayPaid = true;
            lastWeekWasFiveDays = true;
          } else {
            isSundayPaid = false;
            lastWeekWasFiveDays = false;
          }
        } else {
          isSundayPaid = false;
          lastWeekWasFiveDays = false;
        }
      }

      if (isSundayPaid) {
        paidSundaysCount += 1;
      }
    }

    const workedDaysCount = presentDays + halfDays * 0.5;
    totalPaidDays = workedDaysCount + paidSundaysCount;

    // Gross Pay proportional to worked days
    const workedRatio = totalWorkingDays === 0 ? 0 : totalPaidDays / totalWorkingDays;
    grossPay = (salary.monthlySalary || 0) * workedRatio;

    // Payroll Policy breakdown
    const policy = payrollPolicy?.heads || {};
    const basicPct = policy.basic || 0;
    const hraPct = policy.hra || 0;
    const conveyancePct = policy.conveyance || 0;
    const hasAllowanceConfig = basicPct + hraPct + conveyancePct > 0;

    let allowances: Record<string, number> = {};
    if (hasAllowanceConfig) {
      allowances = {
        basic: (basicPct / 100) * grossPay,
        hra: (hraPct / 100) * grossPay,
        conveyance: (conveyancePct / 100) * grossPay,
      };
    } else {
      allowances = {
        basic: grossPay,
        hra: 0,
        conveyance: 0,
      };
    }

    const deductions = {
      pfEmployee: ((policy.pfEmployee || 0) / 100) * grossPay,
      esiEmployee: ((policy.esiEmployee || 0) / 100) * grossPay,
      lwfEmployee: Number(policy.lwfEmployee || 0),
    };

    const totalAllowances = Object.values(allowances).reduce((a, b) => a + b, 0);
    const totalDeductions = Object.values(deductions).reduce((a, b) => a + b, 0);
    basePay = Math.max(0, totalAllowances - totalDeductions);
    payrollDetails = { ...allowances, ...deductions };
  }

  // Overtime Calculation
  let overtimeRate = payrollPolicy?.heads?.overtimeHourlyRate || 0;
  if (!overtimeRate) {
    if (salary.hourlyRate) {
      overtimeRate = salary.hourlyRate;
    } else if (salary.monthlySalary && totalWorkingDays > 0) {
      overtimeRate = Number(((salary.monthlySalary || 0) / (totalWorkingDays * 8)).toFixed(2));
    }
  }
  const overtimePay = totalOvertimeHours * overtimeRate;
  const totalDeductions = (payrollDetails.pfEmployee || 0) + (payrollDetails.esiEmployee || 0) + (payrollDetails.lwfEmployee || 0);
  const grossEarnings = grossPay + overtimePay;
  const netPay = Math.max(0, grossEarnings - totalDeductions);

  return {
    employeeId,
    employeeName,
    employeeCode,
    email: user.email || "",
    designation: user.designation || user.role || "Staff",
    department: user.department || "Operations",
    companyName: user.companyId?.name || "GOEL ENTERPRISES",
    doj: user.doj ? toDateStr(user.doj) : undefined,
    aadharNo: user.aadharNo || undefined,
    pfNo: user.pfNo || undefined,
    esiNo: user.esiNo || undefined,
    mobileNo: user.mobileNo || undefined,
    salaryType,
    rate: round(rate),
    totalCalendarDays: round(calendarDays.length),
    totalWorkingDays: round(totalWorkingDays),
    holidaysCount: round(holidays.length),
    weeklyOffCount: round(weeklyOffDays.length),
    presentDays: round(presentDays),
    halfDays: round(halfDays),
    absentDays: round(absentDays),
    paidSundays: round(paidSundaysCount),
    totalPaidDays: round(totalPaidDays),
    totalWorkedMinutes: round(totalWorkedMinutes),
    totalOvertimeHours: round(totalOvertimeHours),
    overtimeRate: round(overtimeRate),
    basePay: round(basePay),
    overtimePay: round(overtimePay),
    grossEarnings: round(grossEarnings),
    totalDeductions: round(totalDeductions),
    netPay: round(netPay),
    payrollDetails: Object.fromEntries(
      Object.entries(payrollDetails).map(([k, v]) => [k, round(v)])
    ),
  };
};

export const calculateEmployeePayroll = async (c: Context) => {
  try {
    const employeeId = c.req.query("employeeId");
    const month = c.req.query("month"); // format: YYYY-MM

    if (!employeeId || !month) {
      return c.json({ message: "employeeId and month are required" }, 400);
    }
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return c.json({ message: "Invalid employeeId" }, 400);
    }

    const [yearStr, monthNumStr] = month.split("-");
    const year = Number(yearStr);
    const monthNum = Number(monthNumStr);
    const startDate = new Date(Date.UTC(year, monthNum - 1, 1));
    const endDate = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999));
    const employeeObjectId = new mongoose.Types.ObjectId(employeeId);

    const salary = await (EmployeeSalary as any).findOne({
      userId: employeeObjectId,
    }).populate({
      path: "userId",
      select: "name email otherName employeeId companyId payrollPolicyId designation department doj aadharNo pfNo esiNo mobileNo",
      populate: [
        { path: "payrollPolicyId" },
        { path: "companyId", select: "name" },
      ],
    });

    if (!salary) return c.json({ message: "Salary configuration not found for this employee" }, 404);

    const user: any = salary.userId;
    if (!user) return c.json({ message: "Employee user not found" }, 404);

    const calendarDays = await getMonthCalendarDays(startDate, endDate, year, monthNum);

    const attendanceRecords = await Attendance.find({
      userId: employeeObjectId,
      date: { $gte: startDate, $lte: endDate },
    });

    const result = computePayrollDetails({
      salary,
      user,
      attendanceRecords,
      calendarDays,
      startDate,
      endDate,
    });

    return c.json(
      {
        month,
        ...result,
      },
      200
    );
  } catch (err: any) {
    console.error(err);
    return c.json({ message: err.message || "Internal Server Error" }, 500);
  }
};


// ===== CALCULATE ALL EMPLOYEES PAYROLL =====
export const calculateAllEmployeesPayroll = async (c: Context) => {
  try {
    const month = c.req.query("month"); // YYYY-MM
    const companyId = c.req.query("companyId");

    if (!month) {
      return c.json({ message: "month is required (format: YYYY-MM)" }, 400);
    }

    const [yearStr, monthNumStr] = month.split("-");
    const year = Number(yearStr);
    const monthNum = Number(monthNumStr);
    const startDate = new Date(Date.UTC(year, monthNum - 1, 1));
    const endDate = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999));

    const calendarDays = await getMonthCalendarDays(startDate, endDate, year, monthNum);

    const userMatch: any = {};
    if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
      userMatch.companyId = new mongoose.Types.ObjectId(companyId);
    }

    const salaries = await (EmployeeSalary as any).find()
      .populate({
        path: "userId",
        match: Object.keys(userMatch).length > 0 ? userMatch : undefined,
        select: "name email otherName employeeId companyId payrollPolicyId designation department doj aadharNo pfNo esiNo mobileNo",
        populate: [
          { path: "payrollPolicyId" },
          { path: "companyId", select: "name" },
        ],
      });

    const validSalaries = salaries.filter((s: any) => s.userId);

    const round = (num: number) => Number((num || 0).toFixed(2));
    const results: any[] = [];
    let grandTotalNetPay = 0;
    let grandTotalPaidDays = 0;
    let grandTotalOvertimeHours = 0;
    let grandTotalOvertimePay = 0;

    for (const salary of validSalaries) {
      const user: any = salary.userId;
      const employeeId = user._id;

      const attendanceRecords = await Attendance.find({
        userId: employeeId,
        date: { $gte: startDate, $lte: endDate },
      });

      const itemResult = computePayrollDetails({
        salary,
        user,
        attendanceRecords,
        calendarDays,
        startDate,
        endDate,
      });

      grandTotalNetPay += itemResult.netPay;
      grandTotalPaidDays += itemResult.totalPaidDays;
      grandTotalOvertimeHours += itemResult.totalOvertimeHours;
      grandTotalOvertimePay += itemResult.overtimePay;

      results.push({
        ...itemResult,
        status: "success",
      });
    }

    return c.json(
      {
        month,
        summary: {
          totalConfigured: validSalaries.length,
          totalCalculated: results.length,
          totalFailed: 0,
          grandTotalNetPay: round(grandTotalNetPay),
          grandTotalPaidDays: round(grandTotalPaidDays),
          grandTotalOvertimeHours: round(grandTotalOvertimeHours),
          grandTotalOvertimePay: round(grandTotalOvertimePay),
        },
        results,
      },
      200
    );
  } catch (err: any) {
    console.error(err);
    return c.json({ message: err.message || "Internal Server Error" }, 500);
  }
};