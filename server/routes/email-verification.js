'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { authStrictLimiter } = require('../middleware/rateLimiter');
const {
  sendVerificationForUser,
  confirmEmailVerification,
} = require('../services/emailVerificationService');

router.post(
  '/api/auth/email-verification/request',
  authStrictLimiter,
  authenticateToken,
  async (req, res) => {
    try {
      if (req.user.email_verified === true) {
        return res.status(200).json({
          success: true,
          alreadyVerified: true,
          message: 'Your email address is already verified.',
        });
      }

      const result = await sendVerificationForUser({
        userId: req.user.id,
        email: req.user.email,
        requestIp: req.ip,
      });
      if (!result.sent) {
        return res.status(503).json({
          success: false,
          code: 'EMAIL_VERIFICATION_UNAVAILABLE',
          reason: result.reason || 'delivery-unavailable',
          message: result.reason === 'smtp-not-configured'
            ? 'Email verification delivery is not configured yet. Your account remains safe, but fiat customer access stays locked until verification is completed.'
            : 'VaultBank could not send the verification email. Check mail delivery configuration and retry.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'A one-time verification link has been sent to your account email. It expires in 30 minutes.',
        expiresInMinutes: result.expiresInMinutes,
      });
    } catch (error) {
      console.error('Email verification request failed:', error && error.code ? error.code : 'verification-error');
      return res.status(503).json({
        success: false,
        code: 'EMAIL_VERIFICATION_UNAVAILABLE',
        message: 'Could not request an email verification link right now. No customer-access flags were changed.',
      });
    }
  }
);

router.post(
  '/api/auth/email-verification/confirm',
  authStrictLimiter,
  async (req, res) => {
    try {
      const result = await confirmEmailVerification(req.body && req.body.token);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          code: 'EMAIL_VERIFICATION_INVALID',
          message: 'This verification link is invalid, already used, or expired. Request a fresh link after signing in.',
        });
      }
      return res.status(200).json({
        success: true,
        emailVerified: true,
        message: 'Email verified. You can now continue VaultBank identity verification if required.',
      });
    } catch (error) {
      console.error('Email verification confirmation failed:', error && error.code ? error.code : 'verification-error');
      return res.status(503).json({
        success: false,
        code: 'EMAIL_VERIFICATION_UNAVAILABLE',
        message: 'Email verification could not be completed right now. Please retry the link later.',
      });
    }
  }
);

module.exports = router;
