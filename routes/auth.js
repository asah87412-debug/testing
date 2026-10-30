const express = require("express");
const {
  registerUser,
  requestRegisterOtp,
  resendRegisterOtp,
  verifyRegisterOtp,
  loginUser,
  googleLogin,
  requestPasswordReset,
  verifyPasswordResetOtp,
  resetPassword,
  getMe,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

router.post("/register", registerUser);
router.post("/request-register-otp", requestRegisterOtp);
router.post("/resend-register-otp", resendRegisterOtp);
router.post("/verify-register-otp", verifyRegisterOtp);
router.post("/login", loginUser);
router.post("/google", googleLogin);
router.post("/forgot-password", requestPasswordReset);
router.post("/verify-reset-otp", verifyPasswordResetOtp);
router.post("/reset-password", resetPassword);
router.get("/me", authMiddleware, getMe);

module.exports = router;
