import type { Context } from "hono";
import Vehicle from "./vehicle.model";

export const createVehicle = async (c: Context) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();

    const newVehicle = new Vehicle({
      ...body,
      createdBy: user.id,
    });

    await newVehicle.save();

    return c.json({
      message: "Vehicle created successfully",
      data: newVehicle,
    }, 201);
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to create Vehicle" }, 500);
  }
};

export const getVehicles = async (c: Context) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "10");
    const search = c.req.query("search") || "";
    const sortBy = c.req.query("sortBy") || "createdAt";
    const sortOrder = c.req.query("sortOrder") || "desc";

    const skip = (page - 1) * limit;

    const filter: any = {};
    if (search) {
      filter.$or = [
        { vehicleNo: { $regex: search, $options: "i" } },
        { vehicleCode: { $regex: search, $options: "i" } },
        { fuelType: { $regex: search, $options: "i" } }
      ];
    }

    const sort: any = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const [vehicles, total] = await Promise.all([
      Vehicle.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "name email")
        .lean(),
      Vehicle.countDocuments(filter)
    ]);

    const formattedVehicles = vehicles.map((v: any) => ({
      ...v,
      fuelType: v.fuelType || "Diesel"
    }));

    return c.json({
      data: formattedVehicles,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to fetch vehicles" }, 500);
  }
};

export const getVehicleById = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const vehicle = await Vehicle.findById(id).populate("createdBy", "name email").lean();
    if (!vehicle) return c.json({ error: "Vehicle not found" }, 404);
    return c.json({
      ...vehicle,
      fuelType: (vehicle as any).fuelType || "Diesel"
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const updateVehicle = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();

    const updatedVehicle = await Vehicle.findByIdAndUpdate(id, body, {
      new: true,
      runValidators: true,
    });

    if (!updatedVehicle) return c.json({ error: "Vehicle not found" }, 404);

    return c.json({
      message: "Vehicle updated successfully",
      data: updatedVehicle,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const deleteVehicle = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const deletedVehicle = await Vehicle.findByIdAndDelete(id);
    if (!deletedVehicle) return c.json({ error: "Vehicle not found" }, 404);
    return c.json({ message: "Vehicle deleted successfully" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};
