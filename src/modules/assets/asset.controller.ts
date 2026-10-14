import type { Context } from "hono";
import Asset from "./asset.model";

export const createAsset = async (c: Context) => {
  try {
    const body = await c.req.json();
    if (Array.isArray(body)) {
      const assets = await Asset.insertMany(body);
      return c.json({
        message: `${assets.length} assets created successfully`,
        data: assets,
      }, 201);
    }
    const newAsset = new Asset(body);
    await newAsset.save();
    return c.json({
      message: "Asset created successfully",
      data: newAsset,
    }, 201);
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to create asset" }, 500);
  }
};

export const getAssets = async (c: Context) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "10");
    const search = c.req.query("search") || "";
    const status = c.req.query("status");
    const type = c.req.query("type");
    const sortBy = c.req.query("sortBy") || "createdAt";
    const sortOrder = c.req.query("sortOrder") || "desc";

    const skip = (page - 1) * limit;

    const pipeline: any[] = [
      {
        $lookup: {
          from: "users",
          localField: "issuedBy",
          foreignField: "_id",
          as: "issuedByDetails",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "issuedTo",
          foreignField: "_id",
          as: "issuedToDetails",
        },
      },
      {
        $unwind: { path: "$issuedByDetails", preserveNullAndEmptyArrays: true },
      },
      {
        $unwind: { path: "$issuedToDetails", preserveNullAndEmptyArrays: true },
      },
    ];

    const match: any = {};
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: "i" } },
        { serialNumber: { $regex: search, $options: "i" } },
        { type: { $regex: search, $options: "i" } },
        { extraNote: { $regex: search, $options: "i" } },
        { "issuedByDetails.name": { $regex: search, $options: "i" } },
        { "issuedToDetails.name": { $regex: search, $options: "i" } },
      ];
    }

    if (status) match.status = status;
    if (type) match.type = type;

    if (Object.keys(match).length > 0) {
      pipeline.push({ $match: match });
    }

    const sort: any = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const [results, stats] = await Promise.all([
      Asset.aggregate([
        ...pipeline,
        { $sort: sort },
        {
          $addFields: {
            issuedBy: "$issuedByDetails",
            issuedTo: "$issuedToDetails",
          },
        },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            totalCount: [{ $count: "count" }],
          },
        },
      ]),
      Asset.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            issued: [{ $match: { status: "Issued" } }, { $count: "count" }],
            maintenance: [{ $match: { status: "Under Maintenance" } }, { $count: "count" }],
            returned: [{ $match: { status: "Returned" } }, { $count: "count" }],
          },
        },
      ]),
    ]);

    const assets = results[0].data;
    const total = results[0].totalCount[0]?.count || 0;

    const formattedStats = {
      totalAssets: stats[0].total[0]?.count || 0,
      currentlyIssued: stats[0].issued[0]?.count || 0,
      underMaintenance: stats[0].maintenance[0]?.count || 0,
      returned: stats[0].returned[0]?.count || 0,
    };

    return c.json({
      data: assets,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      stats: formattedStats,
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to fetch assets" }, 500);
  }
};

export const getAssetById = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const asset = await Asset.findById(id)
      .populate("issuedBy", "name email")
      .populate("issuedTo", "name email");
    if (!asset) return c.json({ error: "Asset not found" }, 404);
    return c.json(asset);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const updateAsset = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const updatedAsset = await Asset.findByIdAndUpdate(id, body, {
      new: true,
      runValidators: true,
    });
    if (!updatedAsset) return c.json({ error: "Asset not found" }, 404);
    return c.json({
      message: "Asset updated successfully",
      data: updatedAsset,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const deleteAsset = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const deletedAsset = await Asset.findByIdAndDelete(id);
    if (!deletedAsset) return c.json({ error: "Asset not found" }, 404);
    return c.json({ message: "Asset deleted successfully" });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const deleteMultipleAssets = async (c: Context) => {
  try {
    const { ids } = await c.req.json<{ ids: string[] }>();
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "Please provide an array of IDs to delete" }, 400);
    }

    const result = await Asset.deleteMany({ _id: { $in: ids } });
    return c.json({
      message: `${result.deletedCount} assets deleted successfully`,
      data: result,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const unassignAsset = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const updatedAsset = await Asset.findByIdAndUpdate(
      id,
      {
        $unset: { issuedTo: 1 },
        $set: {
          status: "Returned",
          returnedDate: new Date(),
        },
      },
      { new: true }
    );

    if (!updatedAsset) {
      return c.json({ error: "Asset not found" }, 404);
    }

    return c.json({
      message: "Asset unassigned successfully",
      data: updatedAsset,
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};
