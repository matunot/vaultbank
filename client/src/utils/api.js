import { useErrorToast, useSuccessToast, useInfoToast, useWarningToast } from '../components/NotificationContainer';

/**
 * Enhanced fetch wrapper that handles request IDs, toasts, and error responses
 * @param {string} url - API endpoint URL
 * @param {object} options - Fetch options
 * @param {object} toastHooks - { errorToast, successToast, infoToast, warningToast }
 * @param {boolean} showToast - Whether to show request ID in toasts (default: true)
 * @returns {Promise} - Fetch response with enhanced error handling
 */
export const apiRequest = async (url, options = {}, toastHooks = {}) => {
    // Generate or use existing request ID
    const requestId = options.requestId || generateRequestId();

    // Add request headers
    const headers = {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        ...options.headers,
    };

    const enhancedOptions = {
        ...options,
        headers,
        keepalive: options.keepalive || false,
    };

    const { errorToast, successToast, infoToast, warningToast } = toastHooks;

    try {
        const response = await fetch(url, enhancedOptions);

        // Handle successful responses
        if (response.ok) {
            if (successToast && options.showToast !== false) {
                const data = await response.json();
                successToast(`${data.message || 'Operation completed successfully'}`, 3000, requestId);
                // Return the response data with requestId
                return { ...data, requestId };
            }
            return response;
        }

        // Handle rate limiting (429)
        if (response.status === 429) {
            if (errorToast) {
                errorToast('Too many requests. Please wait a moment and try again.', 5000, requestId);
            }
            return { error: 'RATE_LIMIT_EXCEEDED', requestId };
        }

        // Handle other error responses
        if (response.status >= 400) {
            let errorMessage = 'Request failed';
            let errorData = {};

            try {
                errorData = await response.json();
                errorMessage = errorData.message || errorMessage;
            } catch (e) {
                // Response isn't JSON
            }

            // Show appropriate toast based on error type
            if (options.showToast !== false) {
                if (response.status === 401) {
                    // Authentication error - show warning
                    if (warningToast) {
                        warningToast('Authentication required. Please log in again.', 5000, requestId);
                    }
                } else if (response.status === 403) {
                    // Forbidden - feature may require premium
                    if (warningToast) {
                        warningToast('Access denied. This feature may require a premium subscription.', 5000, requestId);
                    }
                } else if (response.status === 404) {
                    // Not found - info level
                    if (infoToast) {
                        infoToast('Requested resource not found.', 4000, requestId);
                    }
                } else if (response.status >= 500) {
                    // Server errors - error level
                    if (errorToast) {
                        errorToast(`Server error: ${errorMessage}`, 6000, requestId);
                    }
                } else {
                    // Other client errors
                    if (errorToast) {
                        errorToast(`Error: ${errorMessage}`, 5000, requestId);
                    }
                }
            }

            return {
                error: errorData,
                message: errorMessage,
                status: response.status,
                requestId
            };
        }

        return response;

    } catch (error) {
        // Network or other errors
        if (errorToast && options.showToast !== false) {
            errorToast(`Network error: ${error.message}`, 5000, requestId);
        }

        return {
            error: 'NETWORK_ERROR',
            message: error.message,
            requestId
        };
    }
};

/**
 * Generate a unique request ID
 * @returns {string} Request ID
 */
export const generateRequestId = () => {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Create a resource fetching function with common behavior
 * @param {string} baseUrl - Base URL for API
 * @returns {object} API resource object
 */
export const createApiResource = (baseUrl = '') => {
    const get = async (endpoint, options = {}, toastHooks) => {
        return apiRequest(`${baseUrl}${endpoint}`, {
            method: 'GET',
            ...options
        }, toastHooks);
    };

    const post = async (endpoint, data = {}, options = {}, toastHooks) => {
        return apiRequest(`${baseUrl}${endpoint}`, {
            method: 'POST',
            body: JSON.stringify(data),
            ...options
        }, toastHooks);
    };

    const put = async (endpoint, data = {}, options = {}, toastHooks) => {
        return apiRequest(`${baseUrl}${endpoint}`, {
            method: 'PUT',
            body: JSON.stringify(data),
            ...options
        }, toastHooks);
    };

    const patch = async (endpoint, data = {}, options = {}, toastHooks) => {
        return apiRequest(`${baseUrl}${endpoint}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            ...options
        }, toastHooks);
    };

    const del = async (endpoint, options = {}, toastHooks) => {
        return apiRequest(`${baseUrl}${endpoint}`, {
            method: 'DELETE',
            ...options
        }, toastHooks);
    };

    return {
        get,
        post,
        put,
        patch,
        delete: del
    };
};

// Default API instance
export const api = createApiResource();

/**
 * Hook to use API with toast integration
 */
export const useApi = () => {
    const errorToast = useErrorToast();
    const successToast = useSuccessToast();
    const infoToast = useInfoToast();
    const warningToast = useWarningToast();

    const toastHooks = {
        errorToast,
        successToast,
        infoToast,
        warningToast
    };

    return {
        apiRequest: (url, options = {}) => apiRequest(url, options, toastHooks),
        api: createApiResource()
    };
};
