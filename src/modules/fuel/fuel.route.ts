import { Hono } from "hono";
import {
  createFuelEntry,
  getFuelEntries,
  getFuelEntryById,
  updateFuelEntry,
  deleteFuelEntry,
  deleteFuelImages,
  exportFuelEntries,
} from "./fuel.controller";
import { verifyToken } from "../../middleware/auth.middleware";

const fuelRoutes = new Hono();

fuelRoutes.use("*", verifyToken);

fuelRoutes.post("/", createFuelEntry);
fuelRoutes.get("/", getFuelEntries);
fuelRoutes.get("/export", exportFuelEntries);
fuelRoutes.get("/:id", getFuelEntryById);
fuelRoutes.patch("/:id", updateFuelEntry);
fuelRoutes.delete("/:id", deleteFuelEntry);
fuelRoutes.post("/delete-images", deleteFuelImages);

export default fuelRoutes;
