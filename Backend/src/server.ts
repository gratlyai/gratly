import express from "express";
import cors from "cors";
import routes from "./routes";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", routes);

app.listen(5000, () => {
  console.log("Backend running on http://localhost:5000");
});
