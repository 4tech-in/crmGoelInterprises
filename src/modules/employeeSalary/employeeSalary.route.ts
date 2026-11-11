import { Hono } from "hono";
import { 
  addEmployeeSalary, 
  calculateEmployeePayroll, 
  calculateAllEmployeesPayroll,
  deleteEmployeeSalary, 
  getEmployeeSalaries, 
  updateEmployeeSalary 
} from "./employeeSalary.Controller";
import { verifyToken } from "../../middleware/auth.middleware";

const employeeSalaryRoutes = new Hono();

employeeSalaryRoutes.use("*", verifyToken);

employeeSalaryRoutes.post("/add", addEmployeeSalary);
employeeSalaryRoutes.get("/get", getEmployeeSalaries);
employeeSalaryRoutes.put("/update/:userId", updateEmployeeSalary);
employeeSalaryRoutes.delete("/delete/:userId", deleteEmployeeSalary);

employeeSalaryRoutes.get("/calculate", calculateEmployeePayroll);
employeeSalaryRoutes.get("/calculate-all", calculateAllEmployeesPayroll);

export default employeeSalaryRoutes;
