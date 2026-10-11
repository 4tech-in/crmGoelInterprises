// models/leave.model.ts
import mongoose, { Schema, Document, Types } from "mongoose";

export interface ILeave extends Document {
  userId: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;

  fromDate: Date;
  toDate: Date;
  totalDays: number;

  leaveType: "Sick" | "Casual" | "Paid" | "Unpaid";
  reason?: string;

  status: "Pending" | "Approved" | "Rejected";
  isPaid: boolean;

  appliedAt: Date;

  approvedBy?: Types.ObjectId;
  approvedAt?: Date;

  rejectionReason?: string;
}

const leaveSchema = new Schema<ILeave>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String },

    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    totalDays: { type: Number, required: true },

    leaveType: {
      type: String,
      enum: [
        "Sick",
        "Casual",
        "Paid",
        "Unpaid",
        "Leave",
        "Earned",
        "Loss of Pay",
        "Maternity",
        "Paternity",
      ],
      default: "Casual",
      required: true,
    },

    reason: String,

    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },

    isPaid: { type: Boolean, default: false },

    appliedAt: { type: Date, default: Date.now },

    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,

    rejectionReason: String,
  },
  { timestamps: true }
);

export default mongoose.model<ILeave>("Leave", leaveSchema);