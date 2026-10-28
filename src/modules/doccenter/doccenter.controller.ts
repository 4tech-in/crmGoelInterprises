import type { Context } from "hono";
import DocCenter from "./doccenter.model";
import path from "path";
import fs from "fs";

const REMOVED_ELECTRICITY_FIELDS = [
  "consumptionCharges",
  "fppca",
  "edRate",
  "ed",
  "fixedCharges",
  "mcTaxRate",
  "mcTax",
  "pfIncentive",
  "regSurcharge",
  "paymentRebate",
  "sundryCharges",
  "arrears",
  "reversalOfArrear",
  "billDate",
  "dueDate",
  "oldReadingKwh",
  "newReadingKwh",
  "oldReadingKvah",
  "newReadingKvah",
  "kwhKvahDiff",
  "powerFactor",
];

const REMOVED_WATER_FIELDS = [
  "billDate",
  "dueDate",
  "oldReading",
  "newReading",
  "actualReading",
  "costPerUnit",
  "currentWaterCharges",
  "maintenanceCharges",
  "sewerageCess",
  "sewerageCessPercentage",
  "meterRentals",
  "garbageCharges",
  "sundryCharges",
  "arrears",
  "adjPrevBill",
  "mcTax",
  "latePaymentSurcharge",
  "paidAmount",
  "paidOn",
];

const removedFieldsFor = (documentType: string) => {
  if (documentType.toLowerCase() === "electricity") return REMOVED_ELECTRICITY_FIELDS;
  if (documentType.toLowerCase() === "water") return REMOVED_WATER_FIELDS;
  return [];
};

const sanitizeMetadata = (metadata: Record<string, any>, documentType: string) => {
  const sanitized = { ...metadata };
  removedFieldsFor(documentType).forEach((key) => delete sanitized[key]);
  return sanitized;
};

const sanitizeDocument = (document: any) => {
  const value = typeof document?.toObject === "function" ? document.toObject() : { ...document };
  value.metadata = sanitizeMetadata(value.metadata || {}, value.documentType || "Other");
  return value;
};

export const uploadDocument = async (c: Context) => {
  try {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const formData = await c.req.formData();
    const title = formData.get("title") as string;
    const documentType = formData.get("documentType") as string;

    if (!title) {
      return c.json({ error: "Title is required" }, 400);
    }

    const files = formData.getAll("files");
    const uploadedFilePaths: string[] = [];

    const uploadDir = path.join(process.cwd(), "uploads", "doccenter");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    for (const file of files) {
      if (file instanceof File && file.size > 0) {
        const timestamp = Date.now();
        // Sanitize filename to avoid space issues
        const sanitizedName = file.name.replace(/\s+/g, "_");
        const uniqueName = `${timestamp}-${sanitizedName}`;
        const filePath = path.join(uploadDir, uniqueName);
        
        await Bun.write(filePath, file);
        
        uploadedFilePaths.push(`/uploads/doccenter/${uniqueName}`);
      }
    }

    // Extract metadata, excluding fields retired for this document type.
    const metadata: Record<string, any> = {};
    const removedFields = removedFieldsFor(documentType || "Other");
    formData.forEach((value, key) => {
      if (!["title", "documentType", "files", "reminder", ...removedFields].includes(key)) {
        metadata[key] = value;
      }
    });


    const newDoc = new DocCenter({
      title,
      documentType: documentType || "Other",
      createdBy: user.id,
      files: uploadedFilePaths,
      metadata,
    });

    await newDoc.save();

    return c.json({
      message: "Document uploaded successfully",
      data: sanitizeDocument(newDoc),
    }, 201);
  } catch (error: any) {
    console.error("Upload error:", error);
    return c.json({ error: error.message || "Failed to upload document" }, 500);
  }
};

export const getDocuments = async (c: Context) => {
  try {
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "10");
    const search = c.req.query("search") || "";
    const sortBy = c.req.query("sortBy") || "createdAt";
    const sortOrder = c.req.query("sortOrder") || "desc";
    const createdBy = c.req.query("createdBy");
    const documentType = c.req.query("documentType");

    const skip = (page - 1) * limit;
    
    // Filter logic
    const filter: any = {};
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { documentType: { $regex: search, $options: "i" } }
      ];
    }
    
    if (createdBy) {
      filter.createdBy = createdBy;
    }

    if (documentType) {
      filter.documentType = documentType;
    }

    const sort: any = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    const [docs, total] = await Promise.all([
      DocCenter.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "name email"),
      DocCenter.countDocuments(filter)
    ]);

    return c.json({
      data: docs.map(sanitizeDocument),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const getDocumentById = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const doc = await DocCenter.findById(id).populate("createdBy", "name email");
    if (!doc) return c.json({ error: "Document not found" }, 404);
    return c.json(sanitizeDocument(doc));
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
};

export const patchDocument = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const contentType = c.req.header("content-type") || "";
    
    let updateData: any = {};

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      
      // Basic fields
      if (formData.has("title")) updateData.title = formData.get("title");
      if (formData.has("documentType")) updateData.documentType = formData.get("documentType");
      if (formData.has("action")) updateData.action = formData.get("action"); // "done" action
      
      // Handle metadata if passed as JSON string in form-data
      if (formData.has("metadata")) {
        try {
          const parsedMeta = JSON.parse(formData.get("metadata") as string);
          updateData.metadata = parsedMeta;
        } catch (e) {}
      }


      // Handle file updates
      const files = formData.getAll("files");
      const validFiles = files.filter((f): f is File => f instanceof File && f.size > 0);
      if (validFiles.length > 0) {
        const newFilePaths: string[] = [];
        const uploadDir = path.join(process.cwd(), "uploads", "doccenter");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        for (const file of validFiles) {
          const timestamp = Date.now();
          const sanitizedName = file.name.replace(/\s+/g, "_");
          const uniqueName = `${timestamp}-${sanitizedName}`;
          const filePath = path.join(uploadDir, uniqueName);
          await Bun.write(filePath, file);
          newFilePaths.push(`/uploads/doccenter/${uniqueName}`);
        }
        updateData.$push = { files: { $each: newFilePaths } };
      }
    } else {
      // Regular JSON update
      updateData = await c.req.json();
    }

    const existingDoc = await DocCenter.findById(id);
    if (!existingDoc) {
      return c.json({ error: "Document not found" }, 404);
    }

    if (updateData.metadata && typeof updateData.metadata === "object") {
      const documentType = String(updateData.documentType || existingDoc.documentType || "Other");
      updateData.metadata = sanitizeMetadata(updateData.metadata, documentType);
    }


    // Separate $push from $set so MongoDB handles both operators correctly
    const { $push, action, ...setFields } = updateData;
    const mongoUpdate: any = {};
    if (Object.keys(setFields).length > 0) mongoUpdate.$set = setFields;
    if ($push) mongoUpdate.$push = $push;

    const updatedDoc = await DocCenter.findByIdAndUpdate(
      id,
      mongoUpdate,
      { returnDocument: 'after', runValidators: true }
    );

    return c.json({
      message: "Document updated successfully",
      data: sanitizeDocument(updatedDoc)
    });
  } catch (error: any) {
    console.error("Patch error:", error);
    return c.json({ error: error.message || "Failed to update document" }, 500);
  }
};

export const deleteDocument = async (c: Context) => {
  try {
    const id = c.req.param("id");
    const doc = await DocCenter.findById(id);
    
    if (!doc) {
      return c.json({ error: "Document not found" }, 404);
    }

    // Delete static files from disk
    if (doc.files && doc.files.length > 0) {
      for (const fileRelativePath of doc.files) {
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

    await DocCenter.findByIdAndDelete(id);

    return c.json({ message: "Document and associated files deleted successfully" });
  } catch (error: any) {
    console.error("Delete error:", error);
    return c.json({ error: error.message || "Failed to delete document" }, 500);
  }
};

export const deleteDocumentFiles = async (c: Context) => {
  try {
    const { documentId, fileUrls } = await c.req.json<{ documentId: string, fileUrls: string[] }>();

    if (!documentId || !fileUrls || !Array.isArray(fileUrls)) {
      return c.json({ error: "documentId and an array of fileUrls are required" }, 400);
    }

    const doc = await DocCenter.findById(documentId);
    if (!doc) {
      return c.json({ error: "Document not found" }, 404);
    }

    const remainingFiles = doc.files.filter(f => !fileUrls.includes(f));
    const filesToDelete = doc.files.filter(f => fileUrls.includes(f));

    // Delete static files from disk
    for (const fileRelativePath of filesToDelete) {
      const fullPath = path.join(process.cwd(), fileRelativePath.startsWith('/') ? fileRelativePath.substring(1) : fileRelativePath);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (err) {
          console.error(`Failed to delete file: ${fullPath}`, err);
        }
      }
    }

    doc.files = remainingFiles;
    await doc.save();

    return c.json({
      message: "Specified files deleted successfully",
      data: doc
    });
  } catch (error: any) {
    console.error("Delete files error:", error);
    return c.json({ error: error.message || "Failed to delete files" }, 500);
  }
};

