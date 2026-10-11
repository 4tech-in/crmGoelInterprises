import mongoose, { Schema, Document } from "mongoose";

export interface IVehicle extends Document {
  vehicleNo: string;
  vehicleCode: string;
  fuelType: "Diesel" | "Petrol";
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VehicleSchema: Schema = new Schema(
  {
    vehicleNo: {
      type: String,
      required: true,
      unique: true
    },
    vehicleCode: {
      type: String,
      required: true,
      unique: true
    },
    fuelType: {
      type: String,
      enum: ["Diesel", "Petrol"],
      default: "Diesel",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IVehicle>("Vehicle", VehicleSchema);
