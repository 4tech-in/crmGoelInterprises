import mongoose, { Schema, Document } from "mongoose";

export interface IFuel extends Document {
  vehicleId: mongoose.Types.ObjectId;
  employeeId?: mongoose.Types.ObjectId;
  odometer: number;
  fuelType: string;
  ratePerLtr: number;
  totalAmount: number;
  fillingDate: Date;
  images: string[];
  average?: number;
  totalFuel?: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FuelSchema: Schema = new Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    odometer: {
      type: Number,
      required: true,
    },
    fuelType: {
      type: String,
      required: true,
    },
    ratePerLtr: {
      type: Number,
      required: true,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    fillingDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    images: [{ type: String }],
    average: {
      type: Number,
      default: 0
    },
    totalFuel: {
      type: Number,
      default: 0
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IFuel>("Fuel", FuelSchema);
