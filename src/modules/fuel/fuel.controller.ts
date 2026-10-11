import type { Context } from "hono";
import Fuel from "./fuel.model";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import * as XLSX from "xlsx";

const calculateFuelAverage = async (vehicleId: any, currentOdometer: number, totalFuel: number, currentEntryId?: string) => {
  try {
    const query: any = { vehicleId };
    if (currentEntryId) {
      query._id = { $ne: currentEntryId };
    }
    
    const prevEntry = await Fuel.findOne(query)
      .sort({ odometer: -1 });
      
    if (prevEntry && prevEntry.odometer < currentOdometer) {
      const distance = currentOdometer - prevEntry.odometer;
      if (totalFuel > 0) {
        return parseFloat((distance / totalFuel).toFixed(2));
      }
    }
  } catch (error) {
    console.error("Error calculating fuel average:", error);
  }
  return 0;
};

export const createFuelEntry = async (c: Context) => {
  try {
    const user = c.get("user");
    const contentType = c.req.header("content-type") || "";
    let fuelData: any = {};
    let uploadedFilePaths: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      
      // Extract basic fields
      fuelData.vehicleId = formData.get("vehicleId");
      if (formData.has("employeeId")) {
        const emp = formData.get("employeeId");
        fuelData.employeeId = emp && emp !== "undefined" && emp !== "null" ? emp : null;
      }
      fuelData.odometer = Number(formData.get("odometer"));
      fuelData.fuelType = formData.get("fuelType");
      fuelData.ratePerLtr = Number(formData.get("ratePerLtr"));
      fuelData.totalAmount = Number(formData.get("totalAmount"));
      if (formData.has("totalFuel")) {
        fuelData.totalFuel = Number(formData.get("totalFuel"));
      }
      if (formData.has("fillingDate")) {
        fuelData.fillingDate = new Date(formData.get("fillingDate") as string);
      }

      // Handle images
      const files = formData.getAll("images");
      const uploadDir = path.join(process.cwd(), "uploads", "fuel");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      for (const file of files) {
        if (file instanceof File) {
          const timestamp = Date.now();
          const sanitizedName = file.name.replace(/\s+/g, "_");
          const uniqueName = `${timestamp}-${sanitizedName}`;
          const filePath = path.join(uploadDir, uniqueName);
          await Bun.write(filePath, file);
          uploadedFilePaths.push(`/uploads/fuel/${uniqueName}`);
        }
      }
      fuelData.images = uploadedFilePaths;
    } else {
      fuelData = await c.req.json();
      if (fuelData.employeeId === "" || fuelData.employeeId === "null" || fuelData.employeeId === "undefined") {
        fuelData.employeeId = null;
      }
    }

    const totalFuel = fuelData.totalFuel !== undefined && !isNaN(fuelData.totalFuel) && fuelData.totalFuel > 0
      ? fuelData.totalFuel
      : (fuelData.ratePerLtr > 0 ? parseFloat((fuelData.totalAmount / fuelData.ratePerLtr).toFixed(2)) : 0);

    const average = await calculateFuelAverage(fuelData.vehicleId, fuelData.odometer, totalFuel);

    const newFuelEntry = new Fuel({
      ...fuelData,
      average,
      totalFuel,
      createdBy: user.id,
    });

    await newFuelEntry.save();

    return c.json({
      message: "Fuel entry created successfully",
      data: newFuelEntry,
    }, 201);
  } catch (error: any) {
    console.error("Create fuel entry error:", error);
    return c.json({ error: error.message || "Failed to create fuel entry" }, 500);
  }
};

export const getFuelEntries = async (c: Context) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "10");
    const search = c.req.query("search") || "";
    const vehicleId = c.req.query("vehicleId");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const sortBy = c.req.query("sortBy") || "createdAt";
    const sortOrder = c.req.query("sortOrder") || "desc";

    const skip = (page - 1) * limit;

    const pipeline: any[] = [
      {
        $lookup: {
          from: "vehicles",
          localField: "vehicleId",
          foreignField: "_id",
          as: "vehicleDetails",
        },
      },
      {
        $unwind: { path: "$vehicleDetails", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "users",
          localField: "employeeId",
          foreignField: "_id",
          as: "employeeDetails",
        },
      },
      {
        $unwind: { path: "$employeeDetails", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      {
        $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true },
      },
    ];

    const match: any = {};
    if (search) {
      match.$or = [
        { "vehicleDetails.vehicleNo": { $regex: search, $options: "i" } },
        { "vehicleDetails.vehicleCode": { $regex: search, $options: "i" } },
        { "employeeDetails.name": { $regex: search, $options: "i" } },
        { "employeeDetails.otherName": { $regex: search, $options: "i" } },
        { fuelType: { $regex: search, $options: "i" } },
      ];
    }

    if (vehicleId) {
      if (mongoose.Types.ObjectId.isValid(vehicleId)) {
        match.$or = [
          { vehicleId: new mongoose.Types.ObjectId(vehicleId) },
          { "vehicleDetails.vehicleNo": vehicleId },
        ];
      } else {
        match["vehicleDetails.vehicleNo"] = vehicleId;
      }
    }

    if (startDate || endDate) {
      match.fillingDate = {};
      if (startDate) {
        const s = new Date(startDate);
        if (!isNaN(s.getTime())) {
          s.setHours(0, 0, 0, 0);
          match.fillingDate.$gte = s;
        }
      }
      if (endDate) {
        const e = new Date(endDate);
        if (!isNaN(e.getTime())) {
          e.setHours(23, 59, 59, 999);
          match.fillingDate.$lte = e;
        }
      }
    }

    if (Object.keys(match).length > 0) {
      pipeline.push({ $match: match });
    }

    const sort: any = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const [results] = await Fuel.aggregate([
      ...pipeline,
      { $sort: sort },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                vehicleId: "$vehicleDetails",
                employeeId: {
                  $cond: {
                    if: "$employeeDetails._id",
                    then: {
                      _id: "$employeeDetails._id",
                      name: "$employeeDetails.name",
                      otherName: "$employeeDetails.otherName",
                      uniqueId: "$employeeDetails.uniqueId",
                      employeeId: "$employeeDetails.employeeId",
                    },
                    else: null,
                  },
                },
                odometer: 1,
                fuelType: 1,
                ratePerLtr: 1,
                totalAmount: 1,
                fillingDate: 1,
                images: 1,
                average: 1,
                totalFuel: 1,
                createdBy: {
                  _id: "$userDetails._id",
                  name: "$userDetails.name",
                  email: "$userDetails.email",
                },
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    const fuelEntries = results.data;
    const total = results.totalCount[0]?.count || 0;

    return c.json({
      data: fuelEntries,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("Get fuel entries error:", error);
    return c.json({ error: error.message || "Failed to fetch fuel entries" }, 500);
  }
};

export const getFuelEntryById = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const entry = await Fuel.findById(id)
      .populate("vehicleId", "vehicleNo vehicleCode")
      .populate("employeeId", "name otherName uniqueId employeeId")
      .populate("createdBy", "name email");
    if (!entry) return c.json({ error: "Fuel entry not found" }, 404);
    return c.json(entry);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const updateFuelEntry = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const contentType = c.req.header("content-type") || "";
    let updateData: any = {};

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      
      // Basic fields
      if (formData.has("vehicleId")) updateData.vehicleId = formData.get("vehicleId");
      if (formData.has("employeeId")) {
        const emp = formData.get("employeeId");
        updateData.employeeId = emp && emp !== "undefined" && emp !== "null" ? emp : null;
      }
      if (formData.has("odometer")) updateData.odometer = Number(formData.get("odometer"));
      if (formData.has("fuelType")) updateData.fuelType = formData.get("fuelType");
      if (formData.has("ratePerLtr")) updateData.ratePerLtr = Number(formData.get("ratePerLtr"));
      if (formData.has("totalAmount")) updateData.totalAmount = Number(formData.get("totalAmount"));
      if (formData.has("totalFuel")) updateData.totalFuel = Number(formData.get("totalFuel"));
      if (formData.has("fillingDate")) updateData.fillingDate = new Date(formData.get("fillingDate") as string);

      // Handle image updates
      const files = formData.getAll("images");
      if (files.length > 0 && files[0] instanceof File) {
        const newFilePaths: string[] = [];
        const uploadDir = path.join(process.cwd(), "uploads", "fuel");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        for (const file of files) {
          if (file instanceof File) {
            const timestamp = Date.now();
            const sanitizedName = file.name.replace(/\s+/g, "_");
            const uniqueName = `${timestamp}-${sanitizedName}`;
            const filePath = path.join(uploadDir, uniqueName);
            await Bun.write(filePath, file);
            newFilePaths.push(`/uploads/fuel/${uniqueName}`);
          }
        }
        updateData.$push = { images: { $each: newFilePaths } };
      }
    } else {
      updateData = await c.req.json();
      if (updateData.employeeId === "" || updateData.employeeId === "null" || updateData.employeeId === "undefined") {
        updateData.employeeId = null;
      }
    }

    const existingEntry = await Fuel.findById(id);
    if (!existingEntry) return c.json({ error: "Fuel entry not found" }, 404);

    const mergedData = {
      vehicleId: updateData.vehicleId || existingEntry.vehicleId,
      odometer: updateData.odometer !== undefined ? updateData.odometer : existingEntry.odometer,
      ratePerLtr: updateData.ratePerLtr !== undefined ? updateData.ratePerLtr : existingEntry.ratePerLtr,
      totalAmount: updateData.totalAmount !== undefined ? updateData.totalAmount : existingEntry.totalAmount,
      totalFuel: updateData.totalFuel !== undefined ? updateData.totalFuel : existingEntry.totalFuel,
    };

    const totalFuel = mergedData.totalFuel !== undefined && !isNaN(mergedData.totalFuel) && mergedData.totalFuel > 0
      ? mergedData.totalFuel
      : (mergedData.ratePerLtr > 0 ? parseFloat((mergedData.totalAmount / mergedData.ratePerLtr).toFixed(2)) : 0);

    const average = await calculateFuelAverage(mergedData.vehicleId, mergedData.odometer, totalFuel, id);

    const { $push, ...setFields } = updateData;
    const mongoUpdate: any = {};
    if (Object.keys(setFields).length > 0) {
      mongoUpdate.$set = { ...setFields, average, totalFuel };
    } else {
      mongoUpdate.$set = { average, totalFuel };
    }
    if ($push) mongoUpdate.$push = $push;

    const updatedEntry = await Fuel.findByIdAndUpdate(
      id,
      mongoUpdate,
      { new: true, runValidators: true }
    );

    if (!updatedEntry) return c.json({ error: "Fuel entry not found" }, 404);

    return c.json({
      message: "Fuel entry updated successfully",
      data: updatedEntry,
    });
  } catch (error: any) {
    console.error("Update fuel entry error:", error);
    return c.json({ error: error.message }, 500);
  }
};

export const deleteFuelEntry = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const entry = await Fuel.findById(id);
    
    if (!entry) {
      return c.json({ error: "Fuel entry not found" }, 404);
    }

    // Delete static files from disk
    if (entry.images && entry.images.length > 0) {
      for (const fileRelativePath of entry.images) {
        const fullPath = path.join(process.cwd(), fileRelativePath.startsWith('/') ? fileRelativePath.substring(1) : fileRelativePath);
        if (fs.existsSync(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
          } catch (err) {
            console.error(`Failed to delete file: ${fullPath}`, err);
          }
        }
      }
    }

    await Fuel.findByIdAndDelete(id);
    return c.json({ message: "Fuel entry and associated images deleted successfully" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const deleteFuelImages = async (c: Context) => {
  try {
    const { fuelId, imagePaths } = await c.req.json<{ fuelId: string, imagePaths: string[] }>();

    if (!fuelId || !imagePaths || !Array.isArray(imagePaths)) {
      return c.json({ error: "fuelId and an array of imagePaths are required" }, 400);
    }

    const entry = await Fuel.findById(fuelId);
    if (!entry) {
      return c.json({ error: "Fuel entry not found" }, 404);
    }

    const remainingImages = entry.images.filter(img => !imagePaths.includes(img));
    const imagesToDelete = entry.images.filter(img => imagePaths.includes(img));

    // Delete static files from disk
    for (const fileRelativePath of imagesToDelete) {
      const fullPath = path.join(process.cwd(), fileRelativePath.startsWith('/') ? fileRelativePath.substring(1) : fileRelativePath);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (err) {
          console.error(`Failed to delete file: ${fullPath}`, err);
        }
      }
    }

    entry.images = remainingImages;
    await entry.save();

    return c.json({
      message: "Specified images deleted successfully",
      data: entry
    });
  } catch (error: any) {
    console.error("Delete images error:", error);
    return c.json({ error: error.message || "Failed to delete images" }, 500);
  }
};

export const exportFuelEntries = async (c: Context) => {
  try {
    const search = c.req.query("search") || "";
    const vehicleId = c.req.query("vehicleId");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const format = c.req.query("format") || "json";

    const pipeline: any[] = [
      {
        $lookup: {
          from: "vehicles",
          localField: "vehicleId",
          foreignField: "_id",
          as: "vehicleDetails",
        },
      },
      {
        $unwind: { path: "$vehicleDetails", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "users",
          localField: "employeeId",
          foreignField: "_id",
          as: "employeeDetails",
        },
      },
      {
        $unwind: { path: "$employeeDetails", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      {
        $unwind: { path: "$userDetails", preserveNullAndEmptyArrays: true },
      },
    ];

    const match: any = {};
    if (search) {
      match.$or = [
        { "vehicleDetails.vehicleNo": { $regex: search, $options: "i" } },
        { "vehicleDetails.vehicleCode": { $regex: search, $options: "i" } },
        { "employeeDetails.name": { $regex: search, $options: "i" } },
        { "employeeDetails.otherName": { $regex: search, $options: "i" } },
        { fuelType: { $regex: search, $options: "i" } },
      ];
    }

    if (vehicleId) {
      if (mongoose.Types.ObjectId.isValid(vehicleId)) {
        match.$or = [
          { vehicleId: new mongoose.Types.ObjectId(vehicleId) },
          { "vehicleDetails.vehicleNo": vehicleId },
        ];
      } else {
        match["vehicleDetails.vehicleNo"] = vehicleId;
      }
    }

    if (startDate || endDate) {
      match.fillingDate = {};
      if (startDate) {
        const s = new Date(startDate);
        if (!isNaN(s.getTime())) {
          s.setHours(0, 0, 0, 0);
          match.fillingDate.$gte = s;
        }
      }
      if (endDate) {
        const e = new Date(endDate);
        if (!isNaN(e.getTime())) {
          e.setHours(23, 59, 59, 999);
          match.fillingDate.$lte = e;
        }
      }
    }

    if (Object.keys(match).length > 0) {
      pipeline.push({ $match: match });
    }

    pipeline.push(
      { $sort: { fillingDate: -1, createdAt: -1 } },
      {
        $project: {
          _id: 1,
          vehicleId: "$vehicleDetails",
          employeeId: {
            $cond: {
              if: "$employeeDetails._id",
              then: {
                _id: "$employeeDetails._id",
                name: "$employeeDetails.name",
                otherName: "$employeeDetails.otherName",
                uniqueId: "$employeeDetails.uniqueId",
                employeeId: "$employeeDetails.employeeId",
              },
              else: null,
            },
          },
          odometer: 1,
          fuelType: 1,
          ratePerLtr: 1,
          totalAmount: 1,
          fillingDate: 1,
          average: 1,
          totalFuel: 1,
          createdBy: {
            _id: "$userDetails._id",
            name: "$userDetails.name",
            email: "$userDetails.email",
          },
          createdAt: 1,
        },
      }
    );

    const data = await Fuel.aggregate(pipeline);

    if (format === "xlsx") {
      const rows = data.map((item, index) => {
        const dateStr = item.fillingDate
          ? new Date(item.fillingDate).toISOString().split("T")[0]
          : "";
        const driverName = item.employeeId
          ? `${item.employeeId.name || ""}${item.employeeId.employeeId ? ` (${item.employeeId.employeeId})` : ""}`
          : "Not assigned";
        return {
          "Sr. No.": index + 1,
          "Date": dateStr,
          "Vehicle No": item.vehicleId?.vehicleNo || "N/A",
          "Vehicle Code": item.vehicleId?.vehicleCode || "",
          "Driver / Employee": driverName,
          "Odometer (KM)": item.odometer ?? 0,
          "Fuel Type": item.fuelType || "Diesel",
          "Rate / Ltr (₹)": item.ratePerLtr ?? 0,
          "Total Fuel (Ltr)": item.totalFuel ?? 0,
          "Average (km/L)": item.average ?? 0,
          "Amount (₹)": item.totalAmount ?? 0,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [
        { wch: 8 },
        { wch: 14 },
        { wch: 18 },
        { wch: 15 },
        { wch: 25 },
        { wch: 15 },
        { wch: 12 },
        { wch: 15 },
        { wch: 16 },
        { wch: 15 },
        { wch: 16 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Fuel Expenses");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      return new Response(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="fuel_expenses_${Date.now()}.xlsx"`,
        },
      });
    }

    return c.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error: any) {
    console.error("Export fuel error:", error);
    return c.json({ error: error.message || "Failed to export fuel entries" }, 500);
  }
};

