import { Hono } from "hono";
import { generateCalendar, updateSingleDate, getMonthCalendar } from "./companyCalendar.controller";
import { verifyToken } from "../../middleware/auth.middleware";

const companyCalendarRouter = new Hono();

companyCalendarRouter.use("*",verifyToken)

companyCalendarRouter.post("/", generateCalendar);
companyCalendarRouter.post("/generate", generateCalendar);

companyCalendarRouter.put("/update-date", updateSingleDate);

// GET month-wise calendar
companyCalendarRouter.get("/month", getMonthCalendar); 

export default companyCalendarRouter;