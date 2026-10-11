import type { Context } from "hono";
import Leave from "./leave.model";
import { EmployeeId } from "../user/employeeId.model";
import { User } from "../user/user.model";




// POST /leave/apply
export const applyLeave = async (c: Context) => {
  try {
    const body = await c.req.json();

    const { userId, employeeId, fromDate, toDate, leaveType, status, reason, name } = body;

    // ✅ validation
    if (!fromDate || !toDate) {
      return c.json(
        { message: "fromDate and toDate are required" },
        400
      );
    }

    const finalLeaveType = leaveType || "Casual";

    let user;

    // ✅ Case 1: userId provided
    if (userId) {
      user = await User.findById(userId).lean();

      if (!user) {
        return c.json({ message: "User not found" }, 404);
      }
    }

    // ✅ Case 2: employeeId provided
    else if (employeeId) {
      const employee = await EmployeeId.findOne({ employeeId }).lean();

      if (!employee) {
        return c.json({ message: "Employee not found" }, 404);
      }

      user = await User.findOne({
        employeeObjId: employee._id,
      }).lean();

      if (!user) {
        return c.json({ message: "User not found" }, 404);
      }
    }

    // ❌ Neither provided
    else {
      return c.json(
        { message: "userId or employeeId is required" },
        400
      );
    }

    // 📅 Date validation
    const start = new Date(fromDate);
    const end = new Date(toDate);

    if (start > end) {
      return c.json(
        { message: "fromDate cannot be greater than toDate" },
        400
      );
    }

    const totalDays =
      Math.floor(
        (end.getTime() - start.getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1;

    // ✅ Create leave
    const leave = await Leave.create({
      userId: user._id,
      companyId: user.companyId,
      fromDate: start,
      toDate: end,
      totalDays,
      leaveType: finalLeaveType,
      reason,
      name,
      status: status || "Pending",
    });

    return c.json(
      {
        success: true,
        message: "Leave applied successfully",
        data: leave,
      },
      201
    );
  } catch (error: any) {
    return c.json({ message: error.message }, 500);
  }
};


// GET /leave
export const getLeaves = async (c: Context) => {
  try {
    const status = c.req.query("status");
    const month = c.req.query("month");
    const year = c.req.query("year");
    const companyId = c.get("companyId");

    const filter: any = {};

    if (status) {
      filter.status = status; // must be "Pending" | "Approved" | "Rejected"
    }

    if (companyId) {
      filter.companyId = companyId;
    }

    // 📅 Date filter
    if (month && year) {
      const startDate = new Date(Number(year), Number(month) - 1, 1);
      const endDate = new Date(Number(year), Number(month), 1);

      filter.createdAt = {
        $gte: startDate,
        $lt: endDate,
      };
    } else if (year) {
      const startDate = new Date(Number(year), 0, 1);
      const endDate = new Date(Number(year) + 1, 0, 1);

      filter.createdAt = {
        $gte: startDate,
        $lt: endDate,
      };
    }

    // 📦 Data
    const leaves = await Leave.find(filter)
      .populate({
        path: "userId",
        select: "name email uniqueId otherName department department departmentId",
        populate: {
          path: "departmentId",
          select: "name"
        }
      })
      .sort({ createdAt: -1 })
      .lean();

    // 📊 Aggregation
    const stats = await Leave.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // ✅ Use exact enum keys
    const counts: any = {
      total: 0,
      Pending: 0,
      Approved: 0,
      Rejected: 0,
    };

    stats.forEach((item) => {
      counts[item._id] = item.count; // matches "Pending", etc.
      counts.total += item.count;
    });

    return c.json(
      {
        success: true,
        data: leaves,
        counts,
      },
      200
    );
  } catch (error: any) {
    return c.json({ message: error.message }, 500);
  }
};

//  Get /leave by usetr Id

// GET /leave/user?userId=xxx&year=2026&month=4
export const getLeavesByUserId = async (c: Context) => {
  try {
    const userId = c.req.query("userId");
    const year = parseInt(c.req.query("year") || "");
    const month = parseInt(c.req.query("month") || "");

    // ✅ validation
    if (!userId) {
      return c.json({ message: "userId is required" }, 400);
    }

    if (!year || !month) {
      return c.json({ message: "year and month are required" }, 400);
    }

    if (month < 1 || month > 12) {
      return c.json({ message: "month must be between 1 to 12" }, 400);
    }

    // ✅ month range
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    // ✅ find leaves overlapping this month
    const leaves = await Leave.find({
      userId,
      fromDate: { $lte: endDate },
      toDate: { $gte: startDate }
    })
      .sort({ fromDate: 1 })
      .lean();

    return c.json(
      {
        success: true,
        data: leaves
      },
      200
    );
  } catch (error: any) {
    return c.json(
      {
        success: false,
        message: error.message || "Failed to fetch leaves"
      },
      500
    );
  }
};


// PUT /leave/update-status/:id
export const updateLeaveStatus = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();

    const { status, isPaid, rejectionReason } = body;

    const user = c.get("user");

    if (!["Approved", "Rejected"].includes(status)) {
      return c.json({ message: "Invalid status" }, 400);
    }

    const leave = await Leave.findById(id);

    if (!leave) {
      return c.json({ message: "Leave not found" }, 404);
    }

    leave.status = status;
    leave.isPaid = isPaid ?? false;
    leave.approvedBy = user.id;
    leave.approvedAt = new Date();

    if (status === "Rejected") {
      leave.rejectionReason = rejectionReason;
    }

    await leave.save();

    return c.json({
      success: true,
      message: `Leave ${status}`,
      data: leave,
    });
  } catch (error: any) {
    return c.json({ message: error.message }, 500);
  }
};