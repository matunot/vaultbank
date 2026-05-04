/**
 * API Configuration - Centralized API base URL management
 * Reads from environment variables with fallback to development defaults
 */

// Determine the API base URL.
// In production (Vercel) the serverless functions are served from the same origin,
// so we use a relative path (empty string) which results in fetch calls like
// `/api/...`. During local development we fall back to the Express dev server.
const API_BASE_URL =
    process.env.NODE_ENV === 'production'
        ? ''
        : process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

// Helper function to create API resource with improved error handling
function createApiResource(baseUrl) {
    return {
        get: async (endpoint, options = {}) => {
            try {
                const token = localStorage.getItem('token');
                const headers = {
                    'Content-Type': 'application/json',
                    ...options.headers,
                };

                // Add authorization header if token exists
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(`${baseUrl}${endpoint}`, {
                    method: 'GET',
                    headers,
                    credentials: 'include',
                    ...options,
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                }

                return await response.json();
            } catch (error) {
                console.error(`API GET error for ${endpoint}:`, error);
                throw error;
            }
        },

        post: async (endpoint, data = {}, options = {}) => {
            try {
                const token = localStorage.getItem('token');
                const headers = {
                    'Content-Type': 'application/json',
                    ...options.headers,
                };

                // Add authorization header if token exists
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(`${baseUrl}${endpoint}`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(data),
                    credentials: 'include',
                    ...options,
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                }

                return await response.json();
            } catch (error) {
                console.error(`API POST error for ${endpoint}:`, error);
                throw error;
            }
        },

        put: async (endpoint, data = {}, options = {}) => {
            try {
                const token = localStorage.getItem('token');
                const headers = {
                    'Content-Type': 'application/json',
                    ...options.headers,
                };

                // Add authorization header if token exists
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(`${baseUrl}${endpoint}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify(data),
                    credentials: 'include',
                    ...options,
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                }

                return await response.json();
            } catch (error) {
                console.error(`API PUT error for ${endpoint}:`, error);
                throw error;
            }
        },

        patch: async (endpoint, data = {}, options = {}) => {
            try {
                const token = localStorage.getItem('token');
                const headers = {
                    'Content-Type': 'application/json',
                    ...options.headers,
                };

                // Add authorization header if token exists
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(`${baseUrl}${endpoint}`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify(data),
                    credentials: 'include',
                    ...options,
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                }

                return await response.json();
            } catch (error) {
                console.error(`API PATCH error for ${endpoint}:`, error);
                throw error;
            }
        },

        delete: async (endpoint, options = {}) => {
            try {
                const token = localStorage.getItem('token');
                const headers = {
                    'Content-Type': 'application/json',
                    ...options.headers,
                };

                // Add authorization header if token exists
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(`${baseUrl}${endpoint}`, {
                    method: 'DELETE',
                    headers,
                    credentials: 'include',
                    ...options,
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                }

                return await response.json();
            } catch (error) {
                console.error(`API DELETE error for ${endpoint}:`, error);
                throw error;
            }
        },
    };
}

// Create API resource with the configured base URL
const api = createApiResource(API_BASE_URL);

// Export the configured API and base URL for use throughout the application
export { api, API_BASE_URL };
