import { Router, type IRouter } from "express";
import healthRouter from "./health";
import icpRouter from "./icp";
import qualifyRouter from "./qualify";
import crmRouter from "./crm";
import mapsRouter from "./maps";
import configRouter from "./config";

const router: IRouter = Router();

router.use(healthRouter);
router.use(icpRouter);
router.use(qualifyRouter);
router.use(crmRouter);
router.use(mapsRouter);
router.use(configRouter);

export default router;
