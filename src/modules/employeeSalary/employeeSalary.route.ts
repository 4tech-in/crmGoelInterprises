import { Hono } from "hono";
import { 
  addEmployeeSalary, 
  calculateEmployeePayroll, 
  calculateAllEmployeesPayroll,
  deleteEmployeeSalary, 
  getEmployeeSalaries, 
  updateEmployeeSalary 
} from "./employeeSalary.Controller";

const employeeSalaryRoutes = new Hono();

employeeSalaryRoutes.post("/add", addEmployeeSalary);
employeeSalaryRoutes.get("/get", getEmployeeSalaries);
employeeSalaryRoutes.put("/update/:userId", updateEmployeeSalary);
employeeSalaryRoutes.delete("/delete/:userId", deleteEmployeeSalary);

employeeSalaryRoutes.get("/calculate", calculateEmployeePayroll);
employeeSalaryRoutes.get("/calculate-all", calculateAllEmployeesPayroll);

export default employeeSalaryRoutes;