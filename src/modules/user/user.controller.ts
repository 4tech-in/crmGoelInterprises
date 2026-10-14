import type { Context } from "hono";
import * as XLSX from "xlsx";
import { User } from "../../modules/user/user.model.ts";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "../auth/auth.type.ts";
import { setCookie } from "hono/cookie";
import { decryptPassword, encryptPassword } from "../../utils/crypto.ts";
import mongoose, { Types } from "mongoose";
import { EmployeeId } from "./employeeId.model.ts";
import { saveFile } from "../../utils/saveFile.ts";
import { DeletedUser } from "./deleteUser.model.ts";
import Asset from "../assets/asset.model.ts";

const JWT_SECRET = process.env.JWT_SECRET as string;


// Login Types
interface LoginBody {
  email: string;
  password: string;
}


const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET missing");
  return secret;
};


//  check duplicate
const checkDuplicateUser = async (
  email?: string,
  uniqueId?: number,
  excludeId?: string
) => {
  const orConditions = [];

  if (email) orConditions.push({ email });
  if (uniqueId) orConditions.push({ uniqueId });

  if (orConditions.length === 0) return null;

  const query: any = {
    $or: orConditions,
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const existing = await User.findOne(query);

  if (!existing) return null;

  if (email && existing.email === email) return "email";
  if (uniqueId && existing.uniqueId === uniqueId) return "uniqueId";

  return null;
};


// ✅ Register

export const register = async (c: Context) => {
  try {
    const formData = await c.req.formData();
    const body = Object.fromEntries(formData.entries());

    const {
      name,
      email,
      password,
      role,
      createdBy,
      employeeObjId,
      uniqueId,
      attendancePolicyId,
      payrollPolicyId,

      otherName,
      category,
      gender,
      fatherName,
      motherName,
      maritalStatus,
      spouseName,
      familyDetails,
      dob,
      bloodGroup,
      emergencyContact,
      reference,
      academicQualification,
      previousWorkExperience,
      interviewDate,
      competencyMet,
      department,
      designation,
      designationId,
      departmentId,
      workingHours,
      aadharNo,
      pfNo,
      esiNo,
      doj,
      doe,
      permanentAddress,
      currentAddress,
      mobileNo,
      companyId,

      alias,
      contactPerson,
      phoneNumber,
      relation,
      familyMembers,
      referredBy,
      passingYear,
      notes
    } = body as any;

    // 🔥 FILES
    const profileImageFile = formData.get("profileImage") as File | null;
    const otherDocsFiles = formData.getAll("otherDocuments") as File[];
    const otherDocsTitles = formData.getAll("otherDocumentsTitle") as string[];

    let profileImage = "";
    let otherDocuments: { title: string; file: string }[] = [];

    // ✅ Basic Validation
    if (!name?.toString().trim()) {
      return c.json({ message: "Name is required" }, 400);
    }

    // ✅ Email Validation (OPTIONAL)
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.toString())) {
        return c.json({ message: "Invalid email format" }, 400);
      }
    }

    // ✅ Password Validation (OPTIONAL)
    if (password && password.toString().length < 6) {
      return c.json(
        { message: "Password must be at least 6 characters" },
        400
      );
    }

    // ✅ Mobile Validation
    if (mobileNo && !/^\d{10}$/.test(mobileNo.toString())) {
      return c.json({ message: "Mobile number must be 10 digits" }, 400);
    }

    // ✅ Aadhar Validation
    if (aadharNo && !/^\d{12}$/.test(aadharNo.toString())) {
      return c.json({ message: "Aadhar number must be 12 digits" }, 400);
    }

    // 🔥 Profile Image Save
    if (profileImageFile && profileImageFile.size > 0) {
      profileImage = await saveFile(profileImageFile, "profile-images");
    }

    // 🔥 Other Documents Save with Title
    if (otherDocsFiles.length > 0) {
      for (let i = 0; i < otherDocsFiles.length; i++) {
        const file = otherDocsFiles[i];
        if (!file) continue;

        const title = otherDocsTitles[i] || `Document ${i + 1}`;

        if (file.size > 0) {
          const filePath = await saveFile(file, "documents");

          otherDocuments.push({
            title: title.toString(),
            file: filePath
          });
        }
      }
    }

    const loggedInUser = c.get("user");

    if (!loggedInUser) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    const safeRole =
      role && ["admin", "hr", "user"].includes(role.toString())
        ? role
        : "user";

    // ✅ Duplicate check (safe)
    const duplicate = await checkDuplicateUser(
      email || undefined,
      uniqueId
    );

    if (duplicate === "email") {
      return c.json({ message: "Email already exists" }, 400);
    }

    if (duplicate === "uniqueId") {
      return c.json({ message: "Unique ID already exists" }, 400);
    }

    // ✅ Encrypt Password (OPTIONAL)
    let encryptedPassword = undefined;
    if (password) {
      encryptedPassword = await encryptPassword(password);
    }

    let finalCreatedBy;

    if (loggedInUser.role === "admin" && createdBy) {
      finalCreatedBy = createdBy;
    } else {
      finalCreatedBy = loggedInUser.id;
    }

    let employeeRef: any = undefined;

    if (employeeObjId) {
      const employee = await EmployeeId.findById(employeeObjId);

      if (!employee) {
        return c.json({ message: "Invalid employee ID" }, 400);
      }

      employeeRef = employee._id;
    }

    const user = await User.create({
      name,
      email: email || undefined,
      password: encryptedPassword,
      role: safeRole,
      createdBy: finalCreatedBy,
      employeeObjId: employeeRef,
      uniqueId,
      attendancePolicyId,
      payrollPolicyId,

      otherName,
      category,
      gender,
      fatherName,
      motherName,
      maritalStatus,
      spouseName,
      familyDetails,
      dob,
      bloodGroup,
      emergencyContact,
      reference,
      academicQualification,
      previousWorkExperience,
      interviewDate,
      competencyMet,
      designation,
      department,
      workingHours,
      aadharNo,
      pfNo,
      esiNo,
      doj,
      doe,
      permanentAddress,
      currentAddress,
      mobileNo,
      companyId,

      profileImage,
      alias,
      contactPerson,
      phoneNumber,
      relation,
      familyMembers,
      referredBy,
      passingYear,
      otherDocuments,
      notes,
      designationId,
      departmentId,
    });

    return c.json(
      {
        message: "User registered successfully",
        data: user
      },
      201
    );
  } catch (error: any) {
    console.error("Register Error:", error);

    if (error?.name === "ValidationError") {
      return c.json({ message: error.message }, 400);
    }

    if (error?.code === 11000) {
      return c.json(
        { message: "Duplicate value found. Email or Unique ID exists." },
        400
      );
    }

    return c.json(
      {
        message: error?.message || "Something went wrong"
      },
      500
    );
  }
};




// ---------------- GET ALL USERS ----------------

// ✅ Plain type (NOT Document)
type IUserPlain = {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: "admin" | "hr" | "user";
  password: any; // encrypted object
  uniqueId: number;

  createdBy: Types.ObjectId;
  employeeObjId: Types.ObjectId;
  companyId?: Types.ObjectId;

  attendancePolicyId?: Types.ObjectId;
  payrollPolicyId?: Types.ObjectId;

  otherName?: string;
  category?: string;
  gender?: string;

  fatherName?: string;
  motherName?: string;
  maritalStatus?: string;
  spouseName?: string;

  familyDetails?: {
    name: string;
    relation: string;
    age?: number;
  }[];

  dob?: Date;
  bloodGroup?: string;

  emergencyContact?: {
    name?: string;
    phone?: string;
    relation?: string;
  };

  reference?: string;

  academicQualification?: {
    degree?: string;
    institute?: string;
    year?: string;
  }[];

  previousWorkExperience?: {
    company?: string;
    role?: string;
    years?: string;
  }[];

  interviewDate?: Date;
  competencyMet?: boolean;

  designation?: string;
  department?: string;
  workingHours?: number;

  aadharNo?: string;
  pfNo?: string;
  esiNo?: string;
  doj?: Date;
  doe?: Date;

  permanentAddress?: string;
  currentAddress?: string;

  mobileNo?: string;

  __v?: number;
};

// ✅ Response type
type IUserResponse = Omit<IUserPlain, "password"> & {
  password?: string | null; // optional (safer)
};

export const getUsers = async (c: Context) => {
  try {
    // ✅ query params
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "10");
    const search = c.req.query("search") || "";
    const companyId = c.req.query("companyId");
    const gender = c.req.query("gender");
    const designationId = c.req.query("designationId");
    const departmentId = c.req.query("departmentId");
    const attendancePolicyStatus = c.req.query("attendancePolicyStatus");

    const skip = (page - 1) * limit;

    // ✅ filter
    const filter: any = {
      role: { $ne: "admin" },
    };

    // ✅ company filter
    if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
      filter.companyId = new mongoose.Types.ObjectId(companyId);
    }

    // ✅ designation filter
    if (designationId && mongoose.Types.ObjectId.isValid(designationId)) {
      filter.designationId = new mongoose.Types.ObjectId(designationId);
    }

    // ✅ department filter
    if (departmentId && mongoose.Types.ObjectId.isValid(departmentId)) {
      filter.departmentId = new mongoose.Types.ObjectId(departmentId);
    }

    // ✅ attendance policy status filter
    if (attendancePolicyStatus === "assigned") {
      filter.attendancePolicyId = { $ne: null };
    } else if (attendancePolicyStatus === "not_assigned") {
      filter.attendancePolicyId = null;
    }

    if (gender) {
      filter.gender = {
        $regex: new RegExp(`^${gender.trim()}$`, "i"),
      };
    }

    // ✅ search filter
    if (search) {
      const orConditions: any[] = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];

      // 👉 if search is a number, match uniqueId
      if (!isNaN(Number(search))) {
        orConditions.push({ uniqueId: Number(search) });
      }

      filter.$or = orConditions;

        // 👉 search by employee code from populated ref
      const employeeMatches = await EmployeeId.find({
        employeeId: { $regex: search, $options: "i" }
      }).select("_id");

      if (employeeMatches.length > 0) {
        orConditions.push({
          employeeObjId: {
            $in: employeeMatches.map((e) => e._id)
          }
        });
      }

    }

    // ✅ fetch users (lean = fast + plain object)
    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .populate("payrollPolicyId", "name")
      .populate("attendancePolicyId", "name")
      .populate("employeeObjId", "employeeId")
      .populate("companyId", "name")
      .populate("designationId", "name")
      .populate("departmentId", "name")
      .skip(skip)
      .limit(limit)
      .lean<IUserPlain[]>(); // ✅ array type

    const totalUsers = await User.countDocuments(filter);

    // ✅ map response
    const result: IUserResponse[] = users?.map((u) => {
      let decryptedPassword: string | null = null;

      // ⚠️ optional (not recommended in real apps)
      try {
        decryptedPassword = decryptPassword(u.password);
      } catch {
        decryptedPassword = null;
      }

      return {
        ...u,
        password: decryptedPassword, // 👉 remove this if you want secure API
      };
    });

    return c.json(
      {
        success: true,
        data: result,
        pagination: {
          total: totalUsers,
          page,
          limit,
          totalPages: Math.ceil(totalUsers / limit),
        },
      },
      200
    );
  } catch (error) {
    console.error("Get Users Error:", error);
    return c.json(
      {
        success: false,
        message: "Internal Server Error",
      },
      500
    );
  }
};

// ---------------- GET SINGLE USER ----------------
export const getUserById = async (c: Context) => {
  try {
    const id = c.req.param("id");

    const user = await User.findById(id)
      .select("-password")
      .populate({ path: "employeeObjId", select: "employeeId" })
      .populate({ path: "attendancePolicyId", select: "name" })
      .populate({ path: "payrollPolicyId", select: "name" })
      .populate({ path: "companyId", select: "name" })
      .populate({ path: "designationId", select: "name" })
      .populate({ path: "departmentId", select: "name" });
    if (!user) {
      return c.json({ message: "User not found" }, 404);
    }

    const assets = await Asset.find({ issuedTo: new Types.ObjectId(id) })
    .select("_id name type serialNumber issuedDate status");
    const userObj = {
      ...user.toObject(),
      assets,
    };

    return c.json(userObj, 200);
  } catch (error) {
    console.error("Get User Error:", error);
    return c.json({ message: "Invalid User ID" }, 400);
  }
};

// ---------------- UPDATE USER ----------------


export const updateUser = async (c: Context) => {
  try {
    const id = c.req.param("id");

    // 🔥 formData (same as register)
    const formData = await c.req.formData();
    const body = Object.fromEntries(formData.entries());

    const user = await User.findById(id);
    if (!user) {
      return c.json({ message: "User not found" }, 404);
    }

    // ---------------- HELPERS ----------------
    const toNumber = (val: any): number | undefined => {
      if (val === undefined || val === null || val === "") return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    };

    // ---------------- ALLOWED FIELDS ----------------
    const allowedFields = Object.keys(User.schema.paths);
    const restrictedFields = ["_id", "__v", "createdAt", "updatedAt"];
    const updatableFields = allowedFields.filter(
      (f) => !restrictedFields.includes(f)
    );

    // ---------------- VALIDATIONS ----------------

    // ✅ Email
    if (body.email !== undefined) {
      const email = body.email.toString().trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(email)) {
        return c.json({ message: "Invalid email format" }, 400);
      }

      const uniqueId =
        body.uniqueId !== undefined
          ? toNumber(body.uniqueId)
          : user.uniqueId;

      if (body.uniqueId !== undefined && uniqueId === undefined) {
        return c.json({ message: "Unique ID must be a number" }, 400);
      }

      const duplicate = await checkDuplicateUser(
        email,
        uniqueId !== undefined ? Number(uniqueId) : undefined,
        id
      );

      if (duplicate === "email") {
        return c.json({ message: "Email already exists" }, 400);
      }

      if (duplicate === "uniqueId") {
        return c.json({ message: "Unique ID already exists" }, 400);
      }
    }

    // ✅ Role
    if (
      body.role &&
      !["admin", "hr", "user"].includes(body.role.toString())
    ) {
      return c.json({ message: "Invalid role" }, 400);
    }

    // ✅ UniqueId
    if (body.uniqueId !== undefined) {
      const uniqueId = toNumber(body.uniqueId);

      if (uniqueId === undefined) {
        return c.json({ message: "Unique ID must be a number" }, 400);
      }

      const duplicate = await checkDuplicateUser(
        body.email ?? user.email,
        uniqueId,
        id
      );

      if (duplicate === "uniqueId") {
        return c.json({ message: "Unique ID already exists" }, 400);
      }

      user.uniqueId = uniqueId;
      user.markModified("uniqueId");
    }

    // ✅ Mobile
    if (body.mobileNo && !/^\d{10}$/.test(body.mobileNo.toString())) {
      return c.json({ message: "Mobile number must be 10 digits" }, 400);
    }

    // ✅ Aadhar
    if (body.aadharNo && !/^\d{12}$/.test(body.aadharNo.toString())) {
      return c.json({ message: "Aadhar number must be 12 digits" }, 400);
    }

    // ---------------- PASSWORD ----------------
    if (body.password) {
      const pass = body.password.toString();

      if (pass.length < 6) {
        return c.json(
          { message: "Password must be at least 6 characters" },
          400
        );
      }

      user.password = await encryptPassword(pass);
      user.markModified("password");

      delete body.password;
    }

    // ---------------- FILE HANDLING ----------------

    const profileImageFile = formData.get("profileImage") as File | null;
    const otherDocsFiles = formData.getAll("otherDocuments") as File[];
    const otherDocsTitles = formData.getAll("otherDocumentsTitle") as string[];

    // ✅ Profile Image
    if (profileImageFile && profileImageFile.size > 0) {
      const uploaded = await saveFile(profileImageFile, "profile-images");
      user.profileImage = uploaded;
      user.markModified("profileImage");
    }

    // ✅ Other Documents
    if (otherDocsFiles.length > 0) {
      const otherDocuments: { title: string; file: string }[] = [];

      for (let i = 0; i < otherDocsFiles.length; i++) {
        const file = otherDocsFiles[i];
        if (!file || file.size === 0) continue;

        const title = otherDocsTitles[i] || `Document ${i + 1}`;
        const filePath = await saveFile(file, "documents");

        otherDocuments.push({
          title: title.toString(),
          file: filePath,
        });
      }

      if (otherDocuments.length > 0) {
        user.otherDocuments = [
          ...(user.otherDocuments || []),
          ...otherDocuments,
        ];

        user.markModified("otherDocuments");
      }
    }

    // ---------------- DYNAMIC UPDATE ----------------

    const skipDynamicFields = [
      "password",
      "profileImage",
      "otherDocuments",
      "otherDocumentsTitle",
      "uniqueId",
    ];

    Object.keys(body).forEach((key) => {
      if (skipDynamicFields.includes(key)) return;

      if (updatableFields.includes(key)) {
        user.set(key, body[key]);
      }
    });

    await user.save();

    // ---------------- RESPONSE ----------------
    return c.json(
      {
        message: "User updated successfully",
        data: user,
      },
      200
    );
  } catch (error: any) {
    console.error("Update Error:", error);

    if (error?.name === "ValidationError") {
      return c.json({ message: error.message }, 400);
    }

    if (error?.code === 11000) {
      return c.json(
        { message: "Duplicate value found. Email or Unique ID exists." },
        400
      );
    }

    return c.json(
      {
        message: error?.message || "Internal Server Error",
      },
      500
    );
  }
};
// export const updateUser = async (c: Context) => {
//   try {
//     const id = c.req.param("id");

//     // 🔥 formData (same as register)
//     const formData = await c.req.formData();
//     const body = Object.fromEntries(formData.entries());

//     const user = await User.findById(id);
//     if (!user) {
//       return c.json({ message: "User not found" }, 404);
//     }

//     // ---------------- HELPERS ----------------
//     const toNumber = (val: any): number | undefined => {
//       if (val === undefined || val === null || val === "") return undefined;
//       const num = Number(val);
//       return isNaN(num) ? undefined : num;
//     };

//     // ---------------- ALLOWED FIELDS ----------------
//     const allowedFields = Object.keys(User.schema.paths);
//     const restrictedFields = ["_id", "__v", "createdAt", "updatedAt"];
//     const updatableFields = allowedFields.filter(
//       (f) => !restrictedFields.includes(f)
//     );

//     // ---------------- VALIDATIONS ----------------

//     // ✅ Email
//     if (body.email !== undefined) {
//       const email = body.email.toString().trim();
//       const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

//       if (!emailRegex.test(email)) {
//         return c.json({ message: "Invalid email format" }, 400);
//       }

//       const uniqueId =
//         body.uniqueId !== undefined
//           ? toNumber(body.uniqueId)
//           : user.uniqueId;

//       if (body.uniqueId !== undefined && uniqueId === undefined) {
//         return c.json({ message: "Unique ID must be a number" }, 400);
//       }

//       const duplicate = await checkDuplicateUser(
//         email,
//         uniqueId !== undefined ? Number(uniqueId) : undefined,
//         id
//       );
//       if (duplicate === "email") {
//         return c.json({ message: "Email already exists" }, 400);
//       }

//       if (duplicate === "uniqueId") {
//         return c.json({ message: "Unique ID already exists" }, 400);
//       }
//     }

//     // ✅ Role
//     if (
//       body.role &&
//       !["admin", "hr", "user"].includes(body.role.toString())
//     ) {
//       return c.json({ message: "Invalid role" }, 400);
//     }

//     // ✅ UniqueId
//     if (body.uniqueId !== undefined) {
//       const uniqueId = toNumber(body.uniqueId);

//       if (uniqueId === undefined) {
//         return c.json({ message: "Unique ID must be a number" }, 400);
//       }

//       const duplicate = await checkDuplicateUser(
//         body.email ?? user.email,
//         uniqueId,
//         id
//       );

//       if (duplicate === "uniqueId") {
//         return c.json({ message: "Unique ID already exists" }, 400);
//       }

//       user.uniqueId = uniqueId;
//       user.markModified("uniqueId");
//     }

//     // ✅ Mobile
//     if (body.mobileNo && !/^\d{10}$/.test(body.mobileNo.toString())) {
//       return c.json({ message: "Mobile number must be 10 digits" }, 400);
//     }

//     // ✅ Aadhar
//     if (body.aadharNo && !/^\d{12}$/.test(body.aadharNo.toString())) {
//       return c.json({ message: "Aadhar number must be 12 digits" }, 400);
//     }

//     // ---------------- PASSWORD ----------------
//     if (body.password) {
//       const pass = body.password.toString();

//       if (pass.length < 6) {
//         return c.json(
//           { message: "Password must be at least 6 characters" },
//           400
//         );
//       }

//       user.password = await encryptPassword(pass);
//       user.markModified("password");

//       delete body.password;
//     }

//     // ---------------- FILE HANDLING ----------------

//     const profileImageFile = formData.get("profileImage") as File | null;
//     const otherDocsFiles = formData.getAll("otherDocuments") as File[];
//     const otherDocsTitles = formData.getAll("otherDocumentsTitle") as string[];

//     // ✅ Profile Image
//     if (profileImageFile && profileImageFile.size > 0) {
//       const uploaded = await saveFile(profileImageFile, "profile-images");
//       user.profileImage = uploaded;
//       user.markModified("profileImage");
//     }

//     // ✅ Other Documents
//     if (otherDocsFiles.length > 0) {
//       const otherDocuments: { title: string; file: string }[] = [];

//       for (let i = 0; i < otherDocsFiles.length; i++) {
//         const file = otherDocsFiles[i];
//         if (!file || file.size === 0) continue;

//         const title = otherDocsTitles[i] || `Document ${i + 1}`;
//         const filePath = await saveFile(file, "documents");

//         otherDocuments.push({
//           title: title.toString(),
//           file: filePath,
//         });
//       }

//       user.otherDocuments = otherDocuments;
//       user.markModified("otherDocuments");
//     }

//     // ---------------- DYNAMIC UPDATE ----------------

//     Object.keys(body).forEach((key) => {
//       if (updatableFields.includes(key)) {
//         user.set(key, body[key]);
//       }
//     });

//     await user.save();

//     // ---------------- RESPONSE ----------------
//     return c.json(
//       {
//         message: "User updated successfully",
//         data: user,
//       },
//       200
//     );
//   } catch (error: any) {
//     console.error("Update Error:", error);

//     if (error?.name === "ValidationError") {
//       return c.json({ message: error.message }, 400);
//     }

//     if (error?.code === 11000) {
//       return c.json(
//         { message: "Duplicate value found. Email or Unique ID exists." },
//         400
//       );
//     }

//     return c.json(
//       {
//         message: error?.message || "Internal Server Error",
//       },
//       500
//     );
//   }
// };



// ---------------- DELETE USER ----------------



export const deleteUser = async (c: Context) => {
  try {
    const id = c.req.param("id");
    
    const user = await User.findById(id);

    if (!user) {
      return c.json({ message: "User not found" }, 404);
    }

    // Check if user has assigned assets
    const assignedAssets = await Asset.find({ issuedTo: new Types.ObjectId(id) })
      .select("_id name type serialNumber issuedDate status");
    if (assignedAssets.length > 0) {
      return c.json(
        {
          message: "Cannot delete user because they have assigned assets. Please unassign the assets first.",
          assets: assignedAssets,
        },
        400
      );
    }

    const userObj = user.toObject() as any;

    // 👉 Save into DeletedUser collection
    await DeletedUser.create(userObj);

    // 👉 Delete from main collection
    await User.findByIdAndDelete(id);

    return c.json(
      { message: "User moved to deleted users successfully" },
      200
    );
  } catch (error) {
    console.error("Delete Error:", error);
    return c.json({ message: "Invalid User ID" }, 400);
  }
};




export const deleteMultipleUsers = async (c: Context) => {
  try {
    const body = await c.req.json();
    const { userIds, companyExitDate } = body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return c.json({ message: "userIds array is required" }, 400);
    }

    const invalidIds = userIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return c.json(
        {
          message: "Invalid user id found",
          invalidIds,
        },
        400
      );
    }

    if (companyExitDate && isNaN(new Date(companyExitDate).getTime())) {
      return c.json({ message: "Invalid companyExitDate" }, 400);
    }

    const users = await User.find({
      _id: { $in: userIds },
    });

    if (users.length === 0) {
      return c.json({ message: "No users found" }, 404);
    }

    // Check if any of the selected users have assigned assets
    const assignedAssets = await Asset.find({ issuedTo: { $in: users.map((u) => u._id) } })
      .select("_id name type serialNumber issuedDate status issuedTo");
    if (assignedAssets.length > 0) {
      return c.json(
        {
          message: "Cannot delete users because one or more users have assigned assets. Please unassign the assets first.",
          assets: assignedAssets,
        },
        400
      );
    }

    const deletedUsers = users.map((user) => {
      const obj = user.toObject();

      return {
        ...obj,
        companyExitDate: companyExitDate ? new Date(companyExitDate) : null,
      };
    });

    await DeletedUser.insertMany(deletedUsers, { ordered: false });

    await User.deleteMany({
      _id: { $in: users.map((u) => u._id) },
    });

    return c.json(
      {
        message: `${users.length} users moved to deleted users successfully`,
      },
      200
    );
  } catch (error: any) {
    console.error("Bulk Delete Error:", error);

    if (error?.name === "SyntaxError") {
      return c.json({ message: "Invalid JSON body" }, 400);
    }

    if (error?.name === "CastError") {
      return c.json(
        {
          message: "Invalid ObjectId",
          field: error.path,
          value: error.value,
        },
        400
      );
    }

    if (error?.name === "ValidationError") {
      return c.json(
        {
          message: error.message,
        },
        400
      );
    }

    if (error?.code === 11000) {
      return c.json(
        {
          message: "User already exists in deleted users",
          duplicateField: Object.keys(error.keyValue || {})[0],
          duplicateValue: Object.values(error.keyValue || {})[0],
        },
        400
      );
    }

    if (error?.writeErrors?.length > 0) {
      const duplicateErrors = error.writeErrors
        .filter((e: any) => e?.code === 11000)
        .map((e: any) => ({
          duplicateField: Object.keys(e.err?.keyValue || {})[0],
          duplicateValue: Object.values(e.err?.keyValue || {})[0],
        }));

      if (duplicateErrors.length > 0) {
        return c.json(
          {
            message: "Some users already exist in deleted users",
            duplicates: duplicateErrors,
          },
          400
        );
      }
    }

    return c.json(
      {
        message: error?.message || "Internal Server Error",
      },
      500
    );
  }
};



// ---------------- USER DROPDOWN ----------------

export const getUsersDropdown = async (c: Context) => {
  try {
    // ✅ query params
    const search = c.req.query("search") || "";
    const companyId = c.req.query("companyId");
    const departmentId = c.req.query("departmentId");
    const limit = parseInt(c.req.query("limit") || "20");
    const page = parseInt(c.req.query("page") || "1");
    const skip = (page - 1) * limit;

    // ✅ base filter
    const filter: any = {
      role: { $ne: "admin" },
    };

    // ✅ company filter
    if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
      filter.companyId = new mongoose.Types.ObjectId(companyId);
    }

    // ✅ department filter
    if (departmentId && mongoose.Types.ObjectId.isValid(departmentId)) {
      filter.departmentId = new mongoose.Types.ObjectId(departmentId);
    }

    // ✅ search by name OR employeeId
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { "employeeData.employeeId": { $regex: search, $options: "i" } },
        {"uniqueId": !isNaN(Number(search)) ? Number(search) : undefined }
      ];
    }
    
    const users = await User.aggregate([
      {
        $lookup: {
          from: "employeeids",
          localField: "employeeObjId",
          foreignField: "_id",
          as: "employeeData"
        }
      },
      {
        $unwind: {
          path: "$employeeData",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: "departments",
          localField: "departmentId",
          foreignField: "_id",
          as: "deptData"
        }
      },
      {
        $unwind: {
          path: "$deptData",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $match: filter
      },
      {
        $project: {
          _id: 1,
          name: 1,
          otherName: 1,
          employeeId: "$employeeData.employeeId",
          uniqueId: 1,
          departmentId: "$departmentId",
          departmentName: { $ifNull: ["$deptData.name", "$department"] },
        }
      },
      { $sort: { name: 1 } },
      { $skip: skip },
      { $limit: limit }
    ]);
  const totalUsers = await User.countDocuments(filter);

    return c.json(
      {
        success: true,
        data: users,
        pagination: {
          total: totalUsers,
          page,
          limit,
          totalPages: Math.ceil(totalUsers / limit),
        },
      },
      200
    );
  } catch (error) {
    console.error("Get Users Dropdown Error:", error);

    return c.json(
      {
        success: false,
        message: "Internal Server Error",
      },
      500
    );
  }
};








// =============================
// GET USERS STATS / COUNTS API
// Overall Total
// Male / Female Count
// Company Wise Count
// =============================

export const getUsersStats = async (c: Context) => {
  try {
    // =============================
    // BASE FILTER (exclude admin)
    // =============================
    const baseFilter: any = {
      role: { $ne: "admin" },
    };

    // =============================
    // OVERALL TOTAL USERS
    // =============================
    const totalUsers = await User.countDocuments(baseFilter);

    // =============================
    // GENDER COUNTS
    // =============================
    const genderStats = await User.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: "$gender",
          count: { $sum: 1 },
        },
      },
    ]);

    let male = 0;
    let female = 0;
    let other = 0;

    genderStats.forEach((item) => {
      const gender = item._id?.toLowerCase();

      if (gender === "male") male = item.count;
      else if (gender === "female") female = item.count;
      else other = item.count;
    });

    // =============================
    // COMPANY WISE USERS COUNT
    // =============================
    const companyWise = await User.aggregate([
      { $match: baseFilter },

      {
        $group: {
          _id: "$companyId",
          totalUsers: { $sum: 1 },

          male: {
            $sum: {
              $cond: [{ $eq: [{ $toLower: "$gender" }, "male"] }, 1, 0],
            },
          },

          female: {
            $sum: {
              $cond: [{ $eq: [{ $toLower: "$gender" }, "female"] }, 1, 0],
            },
          },

          other: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $toLower: "$gender" }, "male"] },
                    { $ne: [{ $toLower: "$gender" }, "female"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },

      // ✅ string to ObjectId convert
      {
        $addFields: {
          companyObjectId: {
            $cond: [
              { $ne: ["$_id", null] },
              { $toObjectId: "$_id" },
              null
            ]
          }
        }
      },

      {
      $lookup: {
        from: "companies",
        let: { companyId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: [
                  { $toString: "$_id" },
                  { $toString: "$$companyId" }
                ]
              }
            }
          },
          {
            $project: {
              name: 1
            }
          }
        ],
        as: "company"
      }
    },

      {
        $unwind: {
          path: "$company",
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $project: {
          _id: 0,
          companyId: "$_id",
          companyName: { $ifNull: ["$company.name", "No Company"] },
          totalUsers: 1,
          male: 1,
          female: 1,
          other: 1,
        },
      },

      { $sort: { totalUsers: -1 } },
    ]);

    // =============================
    // RESPONSE
    // =============================
    return c.json(
      {
        success: true,
        data: {
          overall: {
            totalUsers,
            male,
            female,
            other,
          },
          companyWise,
        },
      },
      200
    );
  } catch (error) {
    console.error("Get Users Stats Error:", error);

    return c.json(
      {
        success: false,
        message: "Internal Server Error",
      },
      500
    );
  }
};






//  user stats male female 

export const genderDistributionWithFilter = async (c: Context) => {
  try {
    // =========================================
    // QUERY PARAMS
    // =========================================
    const companyIds = c.req.query("companyIds");
    const departmentIds = c.req.query("departmentIds");
    const designationIds = c.req.query("designationIds");

    // =========================================
    // BASE FILTER
    // =========================================
    const filter: any = {
      role: { $ne: "admin" },
    };

    // =========================================
    // COMPANY FILTER
    // =========================================
    if (companyIds?.trim()) {
      const companyArray = companyIds
        .split(",")
        .map((id) => id.trim())
        .filter(
          (id) => mongoose.Types.ObjectId.isValid(id)
        )
        .map((id) => new Types.ObjectId(id));

      if (companyArray.length > 0) {
        filter.companyId = {
          $in: companyArray,
        };
      }
    }

    // =========================================
    // DEPARTMENT FILTER
    // =========================================
    if (departmentIds?.trim()) {
      const departmentArray = departmentIds
        .split(",")
        .map((id) => id.trim())
        .filter(
          (id) => mongoose.Types.ObjectId.isValid(id)
        )
        .map((id) => new Types.ObjectId(id));

      if (departmentArray.length > 0) {
        filter.departmentId = {
          $in: departmentArray,
        };
      }
    }

    // =========================================
    // DESIGNATION FILTER
    // =========================================
    if (designationIds?.trim()) {
      const designationArray = designationIds
        .split(",")
        .map((id) => id.trim())
        .filter(
          (id) => mongoose.Types.ObjectId.isValid(id)
        )
        .map((id) => new Types.ObjectId(id));

      if (designationArray.length > 0) {
        filter.designationId = {
          $in: designationArray,
        };
      }
    }

    // =========================================
    // TOTAL USERS
    // =========================================
    const totalUsers = await User.countDocuments(filter);

    // =========================================
    // GENDER STATS
    // =========================================
    const genderStats = await User.aggregate([
      {
        $match: filter,
      },

      {
        $group: {
          _id: null,

          male: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    { $toLower: "$gender" },
                    "male",
                  ],
                },
                1,
                0,
              ],
            },
          },

          female: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    { $toLower: "$gender" },
                    "female",
                  ],
                },
                1,
                0,
              ],
            },
          },

          other: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $ne: [
                        { $toLower: "$gender" },
                        "male",
                      ],
                    },
                    {
                      $ne: [
                        { $toLower: "$gender" },
                        "female",
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    // =========================================
    // DEPARTMENT WISE STATS
    // =========================================
    const departmentWise = await User.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$departmentId",
          totalUsers: { $sum: 1 },
          male: {
            $sum: { $cond: [{ $eq: [{ $toLower: "$gender" }, "male"] }, 1, 0] },
          },
          female: {
            $sum: { $cond: [{ $eq: [{ $toLower: "$gender" }, "female"] }, 1, 0] },
          },
          other: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $toLower: "$gender" }, "male"] },
                    { $ne: [{ $toLower: "$gender" }, "female"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: "departments",
          let: { deptId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [{ $toString: "$_id" }, { $toString: "$$deptId" }],
                },
              },
            },
            { $project: { name: 1 } },
          ],
          as: "dept",
        },
      },
      { $unwind: { path: "$dept", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          departmentId: { $ifNull: [{ $toString: "$_id" }, "unassigned"] },
          departmentName: { $ifNull: ["$dept.name", "Unassigned"] },
          totalUsers: 1,
          male: 1,
          female: 1,
          other: 1,
        },
      },
      { $sort: { totalUsers: -1 } },
    ]);

    // =========================================
    // COMPANY WISE STATS
    // =========================================
    const companyWise = await User.aggregate([
      { $match: { role: { $ne: "admin" } } },
      {
        $group: {
          _id: "$companyId",
          totalUsers: { $sum: 1 },
          male: {
            $sum: { $cond: [{ $eq: [{ $toLower: "$gender" }, "male"] }, 1, 0] },
          },
          female: {
            $sum: { $cond: [{ $eq: [{ $toLower: "$gender" }, "female"] }, 1, 0] },
          },
          other: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $toLower: "$gender" }, "male"] },
                    { $ne: [{ $toLower: "$gender" }, "female"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: "companies",
          let: { compId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: [{ $toString: "$_id" }, { $toString: "$$compId" }],
                },
              },
            },
            { $project: { name: 1 } },
          ],
          as: "company",
        },
      },
      { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          companyId: { $ifNull: [{ $toString: "$_id" }, "unassigned"] },
          companyName: { $ifNull: ["$company.name", "No Company"] },
          totalUsers: 1,
          male: 1,
          female: 1,
          other: 1,
        },
      },
      { $sort: { totalUsers: -1 } },
    ]);

    // =========================================
    // RESPONSE
    // =========================================
    return c.json(
      {
        success: true,

        data: {
          overall: {
            totalUsers,
            male: genderStats[0]?.male || 0,
            female: genderStats[0]?.female || 0,
            other: genderStats[0]?.other || 0,
          },
          totalUsers,
          male: genderStats[0]?.male || 0,
          female: genderStats[0]?.female || 0,
          other: genderStats[0]?.other || 0,
          departmentWise,
          companyWise,
        },
      },
      200
    );
  } catch (error) {
    console.error(
      "Gender Distribution With Filter Error:",
      error
    );

    return c.json(
      {
        success: false,
        message: "Internal Server Error",
        error:
          error instanceof Error
            ? error.message
            : "Unknown Error",
      },
      500
    );
  }
};





// ✅ Login

export const login = async (c: Context) => {
  const body = await c.req.json<LoginBody>();
  const { email, password } = body;

  if (!email || !password) {
    return c.json(
      { message: "Email and password required" },
      400
    );
  }

  const user = await User.findOne({ email }).exec();

  if (!user) {
    return c.json(
      { message: "User not found" },
      404
    );
  }

  if (!user.password) {
  return c.json(
    { message: "Password not set for this user" },
    400
  );
}

  const decryptedPassword = decryptPassword(user.password);

  const isMatch = password === decryptedPassword;

  if (!isMatch) {
    return c.json(
      { message: "Invalid credentials" },
      401
    );
  }

  const token = jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
    } as JwtPayload,
    getJwtSecret(),
    { expiresIn: "7d" }
  );

  return c.json({
    token,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
    },
  });
};



// get deleted user for view

export const getDeletedUsers = async (c: Context) => {
  try {
    const users = await DeletedUser.find()
      .populate("createdBy")
      .populate("employeeObjId", "employeeId prefix")
      .populate("attendancePolicyId", "name")
      .populate("payrollPolicyId", "name")
      .populate("companyId", "name prefix")
      .populate("designationId", "name")
      .populate("departmentId", "name")
      .sort({ createdAt: -1 })
      .lean();

    // Check which employeeObjIds are still available vs already assigned in active User collection
    const activeAssignedIds = await User.find({
      employeeObjId: { $exists: true, $ne: null }
    }).distinct("employeeObjId");

    const activeSet = new Set(activeAssignedIds.map((id) => id.toString()));

    const result = users.map((u: any) => {
      const prevEmpId = u.employeeObjId?._id?.toString();
      const isPreviousEmployeeIdAvailable = prevEmpId ? !activeSet.has(prevEmpId) : false;
      return {
        ...u,
        isPreviousEmployeeIdAvailable,
      };
    });

    return c.json(result, 200);
  } catch (error) {
    console.error("Fetch Deleted Users Error:", error);
    return c.json({ message: "Something went wrong" }, 500);
  }
};


// Restore user API with employee ID assignment & validation
export const restoreUser = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const { employeeObjId } = body;

    // get deleted user
    const deletedUser: any = await DeletedUser.findById(id).lean();

    if (!deletedUser) {
      return c.json(
        {
          message: "Deleted user not found",
        },
        404
      );
    }

    let targetEmployeeObjId = employeeObjId;

    if (targetEmployeeObjId) {
      if (!mongoose.Types.ObjectId.isValid(targetEmployeeObjId)) {
        return c.json({ message: "Invalid Employee ID format" }, 400);
      }

      const empIdDoc = await EmployeeId.findById(targetEmployeeObjId);
      if (!empIdDoc) {
        return c.json({ message: "Selected Employee ID not found" }, 404);
      }

      const alreadyAssigned = await User.findOne({
        employeeObjId: targetEmployeeObjId,
      });
      if (alreadyAssigned) {
        return c.json(
          {
            message: `Employee ID (${empIdDoc.employeeId}) is already assigned to active employee ${alreadyAssigned.name}. Please select another Employee ID.`,
          },
          400
        );
      }

      deletedUser.employeeObjId = targetEmployeeObjId;
    } else {
      // Check if previous employeeObjId exists and is still available
      if (deletedUser.employeeObjId) {
        const alreadyAssigned = await User.findOne({
          employeeObjId: deletedUser.employeeObjId,
        });
        if (alreadyAssigned) {
          return c.json(
            {
              message: "Previous Employee ID is already assigned to another active employee. Please select an available Employee ID to restore.",
              code: "EMPLOYEE_ID_ALREADY_ASSIGNED",
            },
            400
          );
        }
      } else {
        return c.json(
          {
            message: "No Employee ID assigned. Please choose an available Employee ID to restore this employee.",
            code: "EMPLOYEE_ID_REQUIRED",
          },
          400
        );
      }
    }

    // Check uniqueId collision with active users
    if (deletedUser.uniqueId) {
      const activeWithUniqueId = await User.findOne({ uniqueId: deletedUser.uniqueId });
      if (activeWithUniqueId) {
        return c.json(
          {
            message: `Punch ID (${deletedUser.uniqueId}) is already assigned to active user (${activeWithUniqueId.name}).`,
          },
          400
        );
      }
    }

    // Check email collision if present
    if (deletedUser.email) {
      const activeWithEmail = await User.findOne({ email: deletedUser.email });
      if (activeWithEmail) {
        return c.json(
          {
            message: `Email (${deletedUser.email}) is already in use by active user (${activeWithEmail.name}).`,
          },
          400
        );
      }
    }

    // remove unwanted mongoose and deletion fields
    delete deletedUser._id;
    delete deletedUser.__v;
    delete deletedUser.createdAt;
    delete deletedUser.updatedAt;
    delete deletedUser.deletedAt;
    delete deletedUser.deletedBy;
    delete deletedUser.companyExitDate;

    // restore user
    const restoredUser = await User.create(deletedUser);

    // remove from deleted collection
    await DeletedUser.findByIdAndDelete(id);

    return c.json(
      {
        message: "User restored successfully",
        data: restoredUser,
      },
      200
    );
  } catch (error: any) {
    console.error("Restore User Error:", error);

    if (error?.code === 11000) {
      return c.json(
        { message: "Duplicate value found (Email, Unique ID, or Employee ID exists in active users)." },
        400
      );
    }

    return c.json(
      {
        message: error?.message || "Error restoring user",
        error,
      },
      500
    );
  }
};







//  bulk upload users from excel (not implemented yet, just a placeholder)

export const bulkRegister = async (c: Context) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return c.json({ message: "Excel file is required" }, 400);
    }

    let workbook;

    try {
      const arrayBuffer = await file.arrayBuffer();

      workbook = XLSX.read(arrayBuffer, {
        type: "buffer",
        cellDates: true,
      });
    } catch (err) {
      return c.json(
        { message: "Invalid or unsupported file format" },
        400
      );
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return c.json(
        { message: "Excel file has no sheets" },
        400
      );
    }

    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return c.json({ message: "No sheet found in Excel file" }, 400);
    }

    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return c.json({ message: "Sheet data not found" }, 400);
    }

    // ✅ Excel → JSON
    const usersData = XLSX.utils.sheet_to_json(sheet, {
      raw: false,
      dateNF: "yyyy-mm-dd",
    });

    if (!usersData.length) {
      return c.json({ message: "Excel is empty" }, 400);
    }

    const createdUsers = [];
    const updatedUsers = [];
    const errors = [];

    const loggedInUser = c.get("user");

    for (let i = 0; i < usersData.length; i++) {
      const row: any = usersData[i];

      try {
        // 🔥 Required fields
        if (!row.name) {
          throw new Error("Name is required");
        }

        // ✅ Mobile validation
        if (row.mobileNo && !/^\d{10}$/.test(row.mobileNo)) {
          throw new Error("Invalid mobile");
        }

        // ✅ ObjectId safe handling
        const safeObjectId = (val: any) =>
          val && val !== "" ? val : undefined;

        // ✅ Check existing user by uniqueId
        const existingUser = await User.findOne({
          uniqueId: row.uniqueId,
        });

        // =====================================================
        // ✅ UPDATE USER IF DUPLICATE FOUND
        // =====================================================
        if (existingUser) {
          const updateData: any = {};

          // 🔥 Only update fields coming from Excel
          // ❌ Do not overwrite missing fields with null

          if (row.name !== undefined) updateData.name = row.name;

          // ✅ Added otherName
          if (row.otherName !== undefined)
            updateData.otherName = row.otherName;

          // ✅ Added fatherName
          if (row.fatherName !== undefined)
            updateData.fatherName = row.fatherName;

          if (row.mobileNo !== undefined)
            updateData.mobileNo = row.mobileNo;

          if (row.gender !== undefined)
            updateData.gender = row.gender;

          if (row.dob !== undefined)
            updateData.dob = row.dob
              ? new Date(row.dob)
              : existingUser.dob;

          if (row.doj !== undefined)
            updateData.doj = row.doj
              ? new Date(row.doj)
              : existingUser.doj;

          if (row.permanentAddress !== undefined)
            updateData.permanentAddress =
              row.permanentAddress;

          if (row.currentAddress !== undefined)
            updateData.currentAddress =
              row.currentAddress;

          if (row.companyId !== undefined)
            updateData.companyId = safeObjectId(
              row.companyId
            );

          if (row.attendancePolicyId !== undefined)
            updateData.attendancePolicyId =
              safeObjectId(row.attendancePolicyId);

          if (row.payrollPolicyId !== undefined)
            updateData.payrollPolicyId =
              safeObjectId(row.payrollPolicyId);

          await User.findByIdAndUpdate(
            existingUser._id,
            {
              $set: updateData,
            },
            { new: true }
          );

          updatedUsers.push(existingUser);

          continue;
        }

        // =====================================================
        // ✅ CREATE NEW USER
        // =====================================================

        const user = await User.create({
          name: row.name,

          // ✅ Added otherName
          otherName: row.otherName,

          // ✅ Added fatherName
          fatherName: row.fatherName,

          role: "user",

          createdBy: loggedInUser.id,

          uniqueId: row.uniqueId,

          companyId: safeObjectId(row.companyId),
          attendancePolicyId: safeObjectId(
            row.attendancePolicyId
          ),
          payrollPolicyId: safeObjectId(
            row.payrollPolicyId
          ),

          mobileNo: row.mobileNo,
          gender: row.gender,
          dob: row.dob ? new Date(row.dob) : undefined,
          doj: row.doj ? new Date(row.doj) : undefined,
          permanentAddress: row.permanentAddress,
          currentAddress: row.currentAddress,
        });

        createdUsers.push(user);
      } catch (err: any) {
        errors.push({
          row: i + 2,
          error: err.message,
        });
      }
    }

    return c.json({
      message: "Bulk upload completed",
      successCount: createdUsers.length,
      updatedCount: updatedUsers.length,
      errorCount: errors.length,
      errors,
    });
  } catch (error: any) {
    return c.json({ message: error.message }, 500);
  }
};
