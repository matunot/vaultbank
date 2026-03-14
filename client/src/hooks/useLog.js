import { useCallback } from 'react';
import { useInfoToast } from '../components/NotificationContainer';

/**
 * Custom hook for client-side logging
 * @param {string} userId - Current user ID
 * @param {string} subscription - User subscription level
 * @returns {function} log - Logging function
 */
export const useLog = (userId, subscription) => {
    const showInfoToast = useInfoToast();

    const log = useCallback(async (event, meta = {}) => {
        try {
            // Generate request ID for tracking
            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Prepare log data
            const logData = {
                timestamp: new Date().toISOString(),
                userId: userId || 'anonymous',
                subscription: subscription || 'free',
                event,
                meta: {
                    ...meta,
                    userAgent: navigator.userAgent,
                    url: window.location.href,
                    requestId
                }
            };

            // Send to backend logs endpoint
            const response = await fetch('/logs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId
                },
                body: JSON.stringify(logData),
                // Don't block on log failures
                keepalive: true
            });

            // Only log to console on development
            if (process.env.NODE_ENV === 'development') {
                console.log('📝 Log Event:', logData);
            }

            // Show toast for important events on production (non-sensitive)
            if (process.env.NODE_ENV === 'production' && event === 'security_login_attempt') {
                showInfoToast(`Login attempt logged (Request: ${requestId})`, 3000, requestId);
            }

            return { success: response.ok, requestId };

        } catch (error) {
            // Fallback: log to console if server logging fails
            console.error('Logging failed:', error);

            // Show user-friendly toast for connection issues
            if (event === 'error_network' || event === 'error_request_failed') {
                showInfoToast('Network issue detected. Some features may be limited.', 5000);
            }

            return { success: false, error: error.message };
        }
    }, [userId, subscription, showInfoToast]);

    return log;
};

// Predefined event types for consistency
export const LOG_EVENTS = {
    // User actions
    USER_LOGIN: 'user_login',
    USER_LOGOUT: 'user_logout',
    USER_PROFILE_UPDATE: 'user_profile_update',
    USER_SUBSCRIPTION_CHANGE: 'user_subscription_change',

    // Transfer actions
    TRANSFER_INITIATED: 'transfer_initiated',
    TRANSFER_SUCCESS: 'transfer_success',
    TRANSFER_FAILED: 'transfer_failed',
    TRANSFER_CANCELLED: 'transfer_cancelled',

    // Security events
    SECURITY_LOGIN_ATTEMPT: 'security_login_attempt',
    SECURITY_SUSPICIOUS_ACTIVITY: 'security_suspicious_activity',
    SECURITY_RATE_LIMIT: 'security_rate_limit',
    SECURITY_MFA_SUCCESS: 'security_mfa_success',
    SECURITY_MFA_FAILED: 'security_mfa_failed',

    // Payment events
    PAYMENT_PAYPAL_CREATED: 'payment_paypal_created',
    PAYMENT_PAYPAL_CAPTURED: 'payment_paypal_captured',
    PAYMENT_UPI_INITIATED: 'payment_upi_initiated',
    PAYMENT_GPAY_INITIATED: 'payment_gpay_initiated',
    PAYMENT_APPLE_PAY_INITIATED: 'payment_apple_pay_initiated',

    // Error events
    ERROR_NETWORK: 'error_network',
    ERROR_REQUEST_FAILED: 'error_request_failed',
    ERROR_COMPONENT_CRASH: 'error_component_crash',
    ERROR_UNEXPECTED: 'error_unexpected',

    // UI interactions
    UI_BUTTON_CLICK: 'ui_button_click',
    UI_FORM_SUBMIT: 'ui_form_submit',
    UI_NAVIGATION: 'ui_navigation',
    UI_RECEIPT_VIEWED: 'ui_receipt_viewed',

    // Business events
    BUSINESS_TRANSACTION_CREATED: 'business_transaction_created',
    BUSINESS_BALANCE_UPDATED: 'business_balance_updated',
    BUSINESS_EXPORT_GENERATED: 'business_export_generated',
    BUSINESS_REPORT_VIEWED: 'business_report_viewed'
};

export default useLog;
