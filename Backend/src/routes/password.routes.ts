import { Router } from "express";
import { z } from "zod";
import * as accountController from "../controllers/account.controller";
import { validate } from "../middlewares/validate.middleware";

const forgotPasswordSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^\S+$/, "Email cannot contain spaces")
      .email(),
  })
  .strict();

const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    newPassword: z
      .string()
      .min(8)
      .regex(/[A-Za-z]/, "Password must contain at least one letter")
      .regex(/\d/, "Password must contain at least one number")
      .refine(
        (password) => Buffer.byteLength(password, "utf8") <= 72,
        "Password must be at most 72 bytes",
      ),
    confirmNewPassword: z.string(),
  })
  .strict();

export const passwordRouter = Router();

passwordRouter.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  accountController.forgotPassword,
);
passwordRouter.post(
  "/reset-password",
  validate(resetPasswordSchema),
  accountController.resetPassword,
);
