import mongoose, { Document, Schema, Types } from "mongoose";



// 🔐 Type
export interface EncryptedData {
  iv: string;
  content: string;
}


// 👤 User Interface
export interface IUser extends Document {
  name: string;
  email: string;
  password?: EncryptedData;
  role: "admin" | "hr" | "user";
  createdBy: Types.ObjectId;
  employeeObjId: Types.ObjectId;
  uniqueId: Number;
  attendancePolicyId?: Types.ObjectId;
  payrollPolicyId?: Types.ObjectId;

  // 🔥 NEW FIELDS
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
  department?: string;
  designation?: string;
  workingHours?: number;

  aadharNo?: string;
  pfNo?: string;
  esiNo?: string;
  doj?: Date;
  doe?: Date;

  permanentAddress?: string;
  currentAddress?: string;

  mobileNo?: string;
  companyId?: Types.ObjectId;

    // 🔥 New Added Fields
    profileImage?: string;
    alias?: string;
    contactPerson?: string;
    phoneNumber?: string;
    relation?: string;
    familyMembers?: string;
    referredBy?: string;
    passingYear?: string;
    otherDocuments?: {
      title?: string;
      file?: string;
    }[];
  notes?: string;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  designationId?: Types.ObjectId;
  departmentId?: Types.ObjectId;
  companyExitDate?: Date;

}


const deletedUserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },

    email: {
      type: String,
      required: false,
    },

    password: {
      iv: { type: String },
      content: { type: String },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    role: {
      type: String,
      enum: ["admin", "hr", "user"],
      default: "user",
    },

    employeeObjId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmployeeId",
    },

    uniqueId: {
      type: Number,
      required: true,
    },

    attendancePolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendancePolicy",
    },

    payrollPolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PayrollPolicy",
    },

    // 🔥 NEW FIELDS START

    otherName: String,
    category: String,
    gender: String,

    fatherName: String,
    motherName: String,
    maritalStatus: String,
    spouseName: String,

    familyDetails: [
      {
        name: String,
        relation: String,
        age: Number,
      },
    ],

    dob: Date,
    bloodGroup: String,

    emergencyContact: {
      name: String,
      phone: String,
      relation: String,
    },

    reference: String,

    academicQualification: [
      {
        degree: String,
        institute: String,
        year: String,
      },
    ],

    previousWorkExperience: [
      {
        company: String,
        role: String,
        years: String,
      },
    ],

    interviewDate: Date,
    competencyMet: Boolean,
    department: String,
    designation: String,
    workingHours: Number,

    aadharNo: String,
    pfNo: String,
    esiNo: String,
    doj: Date,
    doe: Date,

    permanentAddress: String,
    currentAddress: String,

    mobileNo: String,
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
    },

    // 🔥 NEW FIELDS END

      // User Model Fields Add
  profileImage: { type: String },
  alias: { type: String },
  contactPerson: { type: String },
  phoneNumber: { type: String },
  relation: { type: String },
  familyMembers: { type: String },
  referredBy: { type: String },
  passingYear: { type: String },
  otherDocuments: [
    {
      title: { type: String },
      file: { type: String }
    }
  ],
  notes: { type: String },
  deletedAt: { type: Date, default: Date.now },
deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  designationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation"
  },
  departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department"
  },
},
  { timestamps: true }
);

export const DeletedUser = mongoose.model("DeletedUser", deletedUserSchema);