import { EmployeeId } from "./employeeId.model.ts";
import type { Context } from "hono";
import { User } from "./user.model.ts";
import mongoose from "mongoose";


// ✅ Request Types
interface CreateEmployeeIdBody {
  prefix : string;
  remark: string;

}





// export const generateEmployeeId = async (prefix: string) => {
//   // last record find karo
//   const last = await EmployeeId.findOne({
//     employeeId: new RegExp(`^${prefix}-`)
//   }).sort({ createdAt: -1 });

//   let nextNumber = 1;

// if (last) {
// const lastNumber = parseInt(last.employeeId.split("-")[1] ?? "0", 10);
//   nextNumber = lastNumber + 1;
// }

//   return `${prefix}-${String(nextNumber).padStart(3, "0")}`;
// };

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const generateEmployeeId = async (prefix: string) => {
  const normalizedPrefix = prefix.trim();
  const employeeIdPattern = new RegExp(
    `^${escapeRegExp(normalizedPrefix)}-(\\d+)$`
  );

  const employees = await EmployeeId.find({
    employeeId: employeeIdPattern
  }).select("employeeId");

  const usedNumbers = new Set<number>();

  for (const emp of employees) {
    const match = emp.employeeId.match(employeeIdPattern);
    const number = Number(match?.[1] ?? 0);

    if (Number.isInteger(number) && number > 0) {
      usedNumbers.add(number);
    }
  }

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber++;
  }

  return `${normalizedPrefix}-${String(nextNumber).padStart(3, "0")}`;
};




export const createEmployeeId = async (c: Context) => {
  try {
    const body = await c.req.json<CreateEmployeeIdBody>();
    const { prefix, remark } = body;

    if (!prefix?.trim()) {
      return c.json({ message: "Prefix required" }, 400);
    }

    const normalizedPrefix = prefix.trim();

    // Retry if two requests generate the same ID at the same time. The unique
    // MongoDB index remains the final guarantee that IDs cannot be duplicated.
    for (let attempt = 0; attempt < 5; attempt++) {
      const employeeId = await generateEmployeeId(normalizedPrefix);

      try {
        const data = await EmployeeId.create({
          employeeId,
          prefix: normalizedPrefix,
          remark,
        });

        return c.json(data, 201);
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
      }
    }

    return c.json(
      { message: "Could not generate a unique Employee ID. Please retry." },
      409
    );
  } catch (error: any) {
    return c.json(
      { message: error.message || "Internal Server Error" },
      500
    );
  }
};


export const getEmployeeIds = async (c: Context) => {
  try {
    const companyId = c.req.query("companyId"); 

    const filter: any = {};

    if (companyId) {
      filter.companyId = companyId;
    }

    const data = await EmployeeId.find(filter).sort({ createdAt: -1 });

    return c.json(data, 200);
  } catch (error: any) {
    return c.json(
      { message: error.message || "Failed to fetch employee IDs" },
      500
    );
  }
};


//  ✅ only unassigned employee ids with pagination and search
export const getAvailableEmployeeIds = async (c: Context) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "10");
    const search = c.req.query("search") || "";
    const prefix = c.req.query("prefix")

    const skip = (page - 1) * limit;

    // ✅ already assigned employee ids from users
    const assignedIds = await User.find({
      employeeObjId: { $exists: true, $ne: null }
    }).distinct("employeeObjId");

    // ✅ filter
    const query: any = {
      _id: { $nin: assignedIds }
    };

    if (search.trim()) {
      query.employeeId = { $regex: search, $options: "i" };
    }
    if(prefix){
      query.prefix = prefix;
    }

    const [data, total] = await Promise.all([
      EmployeeId.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),

      EmployeeId.countDocuments(query)
    ]);

    return c.json(
      {
        data,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      },
      200
    );
  } catch (error: any) {
    return c.json(
      {
        message: error.message || "Failed to fetch available employee IDs"
      },
      500
    );
  }
};


export const updateEmployeeId = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json<{ remark?: string }>();

    const data = await EmployeeId.findByIdAndUpdate(
      id,
      {
        $set: body,
      },
      { new: true }
    );

    if (!data) {
      return c.json({ message: "Employee ID not found" }, 404);
    }

    return c.json(data, 200);
  } catch (error: any) {
    return c.json(
      { message: error.message || "Update failed" },
      500
    );
  }
};


export const deleteEmployeeId = async (c: Context) => {
  try {
    const id = c.req.param("id");

    const data = await EmployeeId.findByIdAndDelete(id);

    if (!data) {
      return c.json({ message: "Employee ID not found" }, 404);
    }

    return c.json({ message: "Employee ID deleted successfully" }, 200);
  } catch (error: any) {
    return c.json(
      { message: error.message || "Delete failed" },
      500
    );
  }
};
