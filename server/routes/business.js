const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { demoStore } = require('../config/database');

const router = express.Router();

/**
 * POST /api/business/create
 * Create a new business account
 */
router.post('/api/business/create', authenticateToken, (req, res) => {
    try {
        const { businessName, businessType, industry, description, address } = req.body;
        const userId = req.user.id;

        if (!businessName || !businessType) {
            return res.status(400).json({
                success: false,
                message: 'Business name and type are required.'
            });
        }

        // Check if user already has a business
        const existingBusiness = demoStore.businesses.find(b => b.ownerId === userId);
        if (existingBusiness) {
            return res.status(409).json({
                success: false,
                message: 'You already have a business account.',
                data: { business: existingBusiness }
            });
        }

        const business = {
            id: uuidv4(),
            _id: uuidv4(),
            ownerId: userId,
            businessName,
            businessType,
            industry: industry || 'other',
            description: description || '',
            address: address || '',
            status: 'active',
            employees: [],
            invoices: [],
            payrolls: [],
            revenue: 0,
            expenses: 0,
            createdAt: new Date().toISOString()
        };

        demoStore.businesses.push(business);

        // Audit log
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId,
            action: 'business_created',
            category: 'business',
            resourceId: business.id,
            details: JSON.stringify({ businessName, businessType }),
            timestamp: new Date().toISOString()
        });

        return res.status(201).json({
            success: true,
            message: 'Business account created successfully!',
            data: { business }
        });

    } catch (error) {
        console.error('Business create error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error creating business account.'
        });
    }
});

/**
 * GET /api/business/me
 * Get current user's business
 */
router.get('/api/business/me', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const business = demoStore.businesses.find(b => b.ownerId === userId);

        if (!business) {
            return res.status(404).json({
                success: false,
                message: 'No business account found.'
            });
        }

        return res.status(200).json({
            success: true,
            data: { business }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching business.' });
    }
});

/**
 * POST /api/business/payroll
 * Create payroll entry
 */
router.post('/api/business/payroll', authenticateToken, (req, res) => {
    try {
        const { businessId, employeeName, employeeEmail, salaryUSD, payDate, deductions, bonuses } = req.body;
        const userId = req.user.id;

        if (!businessId || !employeeName || !salaryUSD) {
            return res.status(400).json({
                success: false,
                message: 'Business ID, employee name, and salary are required.'
            });
        }

        // Verify business ownership
        const business = demoStore.businesses.find(b => b.id === businessId && b.ownerId === userId);
        if (!business) {
            return res.status(404).json({
                success: false,
                message: 'Business not found or access denied.'
            });
        }

        const totalDeductions = (deductions || []).reduce((sum, d) => sum + (d.amount || 0), 0);
        const totalBonuses = (bonuses || []).reduce((sum, b) => sum + (b.amount || 0), 0);
        const netPay = salaryUSD - totalDeductions + totalBonuses;

        const payroll = {
            id: uuidv4(),
            _id: uuidv4(),
            businessId,
            employeeName,
            employeeEmail: employeeEmail || '',
            salaryUSD: parseFloat(salaryUSD),
            deductions: deductions || [],
            bonuses: bonuses || [],
            totalDeductions,
            totalBonuses,
            netPay,
            payDate: payDate || new Date().toISOString().split('T')[0],
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        demoStore.payrolls.push(payroll);

        // Update business payrolls array
        const businessIndex = demoStore.businesses.findIndex(b => b.id === businessId);
        if (businessIndex !== -1) {
            if (!demoStore.businesses[businessIndex].payrolls) {
                demoStore.businesses[businessIndex].payrolls = [];
            }
            demoStore.businesses[businessIndex].payrolls.push(payroll);
        }

        // Audit log
        demoStore.auditLogs.push({
            id: uuidv4(),
            userId,
            action: 'payroll_created',
            category: 'business',
            resourceId: payroll.id,
            details: JSON.stringify({ employeeName, salaryUSD, netPay }),
            timestamp: new Date().toISOString()
        });

        return res.status(201).json({
            success: true,
            message: 'Payroll entry created successfully.',
            data: { payroll }
        });

    } catch (error) {
        console.error('Payroll create error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error creating payroll entry.'
        });
    }
});

/**
 * GET /api/business/:businessId/payroll
 * Get all payroll entries for a business
 */
router.get('/api/business/:businessId/payroll', authenticateToken, (req, res) => {
    try {
        const { businessId } = req.params;
        const userId = req.user.id;

        const business = demoStore.businesses.find(b => b.id === businessId && b.ownerId === userId);
        if (!business) {
            return res.status(404).json({ success: false, message: 'Business not found.' });
        }

        const payrolls = demoStore.payrolls.filter(p => p.businessId === businessId);

        return res.status(200).json({
            success: true,
            data: { payrolls },
            count: payrolls.length
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching payroll.' });
    }
});

/**
 * POST /api/business/invoice
 * Create a new invoice
 */
router.post('/api/business/invoice', authenticateToken, (req, res) => {
    try {
        const { businessId, clientName, clientEmail, items, dueDate, notes } = req.body;
        const userId = req.user.id;

        if (!businessId || !clientName || !items || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Business ID, client name, and items are required.'
            });
        }

        const business = demoStore.businesses.find(b => b.id === businessId && b.ownerId === userId);
        if (!business) {
            return res.status(404).json({ success: false, message: 'Business not found.' });
        }

        const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        const tax = subtotal * 0.1; // 10% tax
        const total = subtotal + tax;

        const invoice = {
            id: uuidv4(),
            invoiceNumber: `INV-${Date.now()}`,
            businessId,
            clientName,
            clientEmail: clientEmail || '',
            items,
            subtotal,
            tax,
            total,
            dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            notes: notes || '',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        // Add to business invoices
        const businessIndex = demoStore.businesses.findIndex(b => b.id === businessId);
        if (businessIndex !== -1) {
            if (!demoStore.businesses[businessIndex].invoices) {
                demoStore.businesses[businessIndex].invoices = [];
            }
            demoStore.businesses[businessIndex].invoices.push(invoice);
        }

        return res.status(201).json({
            success: true,
            message: 'Invoice created successfully.',
            data: { invoice }
        });

    } catch (error) {
        console.error('Invoice create error:', error);
        return res.status(500).json({ success: false, message: 'Error creating invoice.' });
    }
});

/**
 * GET /api/business/:businessId/analytics
 * Get business analytics
 */
router.get('/api/business/:businessId/analytics', authenticateToken, (req, res) => {
    try {
        const { businessId } = req.params;
        const userId = req.user.id;

        const business = demoStore.businesses.find(b => b.id === businessId && b.ownerId === userId);
        if (!business) {
            return res.status(404).json({ success: false, message: 'Business not found.' });
        }

        const payrolls = demoStore.payrolls.filter(p => p.businessId === businessId);
        const invoices = business.invoices || [];

        const totalPayroll = payrolls.reduce((sum, p) => sum + (p.netPay || 0), 0);
        const totalRevenue = invoices
            .filter(i => i.status === 'paid')
            .reduce((sum, i) => sum + (i.total || 0), 0);
        const pendingInvoices = invoices.filter(i => i.status === 'pending').length;

        const analytics = {
            revenue: totalRevenue,
            expenses: totalPayroll,
            profit: totalRevenue - totalPayroll,
            employeeCount: business.employees?.length || payrolls.length,
            invoiceCount: invoices.length,
            pendingInvoices,
            payrollCount: payrolls.length,
            monthlyData: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                revenue: [0, 0, 0, 0, 0, totalRevenue],
                expenses: [0, 0, 0, 0, 0, totalPayroll]
            }
        };

        return res.status(200).json({
            success: true,
            data: { analytics, business }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching analytics.' });
    }
});

/**
 * GET /api/business
 * List all businesses (admin) or user's business
 */
router.get('/api/business', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

        const businesses = isAdmin
            ? demoStore.businesses
            : demoStore.businesses.filter(b => b.ownerId === userId);

        return res.status(200).json({
            success: true,
            data: { businesses },
            count: businesses.length
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching businesses.' });
    }
});

module.exports = router;
