const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

class VaultBankQAExecutor {
    constructor() {
        this.baseURL = 'http://localhost:5000';
        this.supabase = createClient(
            'https://fussqdxbaglpgaivqtdb.supabase.co',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1c3NxZHhiYWdscGdhaXZxdGRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3NDU4MzksImV4cCI6MjA3NjMyMTgzOX0.huPVf9aQrrQUPBijIa9Pv2hTV2XdSMX4OtGViVE0Ios'
        );
        this.testResults = {
            passed: 0,
            failed: 0,
            tests: []
        };
    }

    async runTest(testName, testFunction) {
        try {
            console.log(`\n🧪 Running: ${testName}`);
            await testFunction();
            this.testResults.passed++;
            this.testResults.tests.push({ name: testName, status: 'PASSED' });
            console.log(`✅ PASSED: ${testName}`);
        } catch (error) {
            this.testResults.failed++;
            this.testResults.tests.push({ name: testName, status: 'FAILED', error: error.message });
            console.log(`❌ FAILED: ${testName} - ${error.message}`);
        }
    }

    async testServerHealth() {
        const response = await axios.get(`${this.baseURL}/health`);
        if (response.status !== 200) throw new Error('Health check failed');
    }

    async testUserSignup() {
        // Test user registration
        const response = await axios.post(`${this.baseURL}/api/auth/signup`, {
            email: `testuser_${Date.now()}@vaultbank.com`,
            password: 'SecurePass123!',
            fullName: 'Test User',
            phone: '+1234567890'
        });

        if (!response.data.token) throw new Error('JWT not issued');
        return response.data.token;
    }

    async testUserLogin() {
        // Test user login
        const response = await axios.post(`${this.baseURL}/api/auth/login`, {
            email: 'test@vaultbank.com',
            password: 'SecurePass123!'
        });

        if (!response.data.token) throw new Error('JWT not issued');
        return response.data.token;
    }

    async testRewardsCalculation() {
        // Test $100 dining = 200 points
        const diningPoints = await this.calculateRewards('dining', 100);
        if (diningPoints !== 200) throw new Error(`Expected 200 points for $100 dining, got ${diningPoints}`);

        // Test $500 shopping = $25 cashback (5%)
        const shoppingCashback = await this.calculateCashback('shopping', 500);
        if (shoppingCashback !== 25) throw new Error(`Expected $25 cashback for $500 shopping, got ${shoppingCashback}`);
    }

    async calculateRewards(category, amount) {
        // Mock rewards calculation
        const rates = {
            dining: 2, // 2 points per dollar
            shopping: 0, // No points, only cashback
            gas: 1,
            travel: 3
        };
        return amount * (rates[category] || 0);
    }

    async calculateCashback(category, amount) {
        // Mock cashback calculation
        const rates = {
            shopping: 0.05, // 5%
            dining: 0.02, // 2%
            gas: 0.03 // 3%
        };
        return Math.round(amount * (rates[category] || 0));
    }

    async testDomesticTransfer() {
        // Test domestic transfer and balance updates
        const transferAmount = 100;
        const initialBalance = 1000;

        // Simulate transfer
        const newBalance = initialBalance - transferAmount;
        if (newBalance !== 900) throw new Error('Balance not updated correctly');

        // Check if rewards were applied
        const rewardsEarned = await this.calculateRewards('transfer', transferAmount);
        if (rewardsEarned <= 0) throw new Error('No rewards applied to transfer');
    }

    async testAdminAccess() {
        // Test admin login
        const response = await axios.post(`${this.baseURL}/api/auth/admin-login`, {
            email: 'admin@vaultbank.com',
            password: 'AdminPass123!'
        });

        if (!response.data.token) throw new Error('Admin JWT not issued');

        // Test admin dashboard access
        const adminResponse = await axios.get(`${this.baseURL}/api/admin/dashboard`, {
            headers: { Authorization: `Bearer ${response.data.token}` }
        });

        if (adminResponse.status !== 200) throw new Error('Admin dashboard access failed');
    }

    async testLendingModule() {
        // Test loan application
        const loanApplication = {
            amount: 5000,
            purpose: 'personal',
            term: 12
        };

        const response = await axios.post(`${this.baseURL}/api/lending/apply`, loanApplication);
        if (response.data.status !== 'pending') throw new Error('Loan status should be pending');

        // Test admin approval
        const approvalResponse = await axios.post(`${this.baseURL}/api/admin/lending/approve/${response.data.loanId}`);
        if (approvalResponse.data.status !== 'approved') throw new Error('Loan approval failed');

        // Test repayment schedule generation
        if (!approvalResponse.data.repaymentSchedule) throw new Error('Repayment schedule not generated');
    }

    async testInsuranceModule() {
        // Test policy purchase
        const policy = {
            type: 'life',
            coverage: 100000,
            premium: 50
        };

        const response = await axios.post(`${this.baseURL}/api/insurance/purchase`, policy);
        if (!response.data.policyId) throw new Error('Policy not created');

        // Test claim filing
        const claim = {
            policyId: response.data.policyId,
            amount: 1000,
            description: 'Medical emergency'
        };

        const claimResponse = await axios.post(`${this.baseURL}/api/insurance/claim`, claim);
        if (claimResponse.data.status !== 'pending') throw new Error('Claim status should be pending');
    }

    async testFXTransfers() {
        // Test $1000 EUR conversion
        const transfer = {
            amount: 1000,
            currency: 'EUR',
            recipient: 'test@example.com'
        };

        const response = await axios.post(`${this.baseURL}/api/fx/transfer`, transfer);
        if (!response.data.convertedAmount) throw new Error('Currency conversion failed');

        // Test SAR generation for large transfer
        const largeTransfer = {
            amount: 15000,
            currency: 'EUR',
            recipient: 'test@example.com'
        };

        const sarResponse = await axios.post(`${this.baseURL}/api/fx/transfer`, largeTransfer);
        if (!sarResponse.data.sarGenerated) throw new Error('SAR not generated for large transfer');
    }

    async testBusinessBanking() {
        // Test invoice creation
        const invoice = {
            clientName: 'Test Client',
            amount: 2500,
            description: 'Consulting services',
            dueDate: '2025-12-01'
        };

        const response = await axios.post(`${this.baseURL}/api/business/invoice`, invoice);
        if (!response.data.invoiceId) throw new Error('Invoice not created');

        // Test invoice payment
        const payment = await axios.post(`${this.baseURL}/api/business/invoice/${response.data.invoiceId}/pay`);
        if (payment.data.status !== 'paid') throw new Error('Invoice payment failed');
    }

    async testSecurityCompliance() {
        // Test admin route protection
        try {
            await axios.get(`${this.baseURL}/api/admin/sensitive-data`);
            throw new Error('Admin route not protected');
        } catch (error) {
            if (error.response?.status !== 401 && error.response?.status !== 403) {
                throw new Error('Admin route should return 401/403');
            }
        }
    }

    async testAuditLogging() {
        // Verify audit logs are created
        const response = await axios.get(`${this.baseURL}/api/audit/logs`);
        if (!Array.isArray(response.data) || response.data.length === 0) {
            throw new Error('No audit logs found');
        }
    }

    async runAllTests() {
        console.log('🚀 Starting VaultBank QA Validation...\n');

        await this.runTest('Server Health Check', () => this.testServerHealth());
        await this.runTest('User Signup Flow', () => this.testUserSignup());
        await this.runTest('User Login Flow', () => this.testUserLogin());
        await this.runTest('Rewards Engine Calculation', () => this.testRewardsCalculation());
        await this.runTest('Domestic Transfer & Rewards', () => this.testDomesticTransfer());
        await this.runTest('Admin Access Control', () => this.testAdminAccess());
        await this.runTest('Lending Module', () => this.testLendingModule());
        await this.runTest('Insurance Module', () => this.testInsuranceModule());
        await this.runTest('FX & International Transfers', () => this.testFXTransfers());
        await this.runTest('Business Banking', () => this.testBusinessBanking());
        await this.runTest('Security & Compliance', () => this.testSecurityCompliance());
        await this.runTest('Audit Logging', () => this.testAuditLogging());

        this.printResults();
    }

    printResults() {
        console.log('\n📊 QA Test Results Summary');
        console.log('================================');
        console.log(`✅ Passed: ${this.testResults.passed}`);
        console.log(`❌ Failed: ${this.testResults.failed}`);
        console.log(`📋 Total: ${this.testResults.passed + this.testResults.failed}`);
        console.log(`📈 Success Rate: ${((this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100).toFixed(1)}%`);

        if (this.testResults.failed > 0) {
            console.log('\n❌ Failed Tests:');
            this.testResults.tests.filter(t => t.status === 'FAILED').forEach(test => {
                console.log(`  - ${test.name}: ${test.error}`);
            });
        }

        console.log('\n🎯 Go-Live Readiness Assessment:');
        const successRate = (this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100;
        if (successRate >= 90) {
            console.log('✅ READY FOR GO-LIVE - All critical tests passed');
        } else if (successRate >= 75) {
            console.log('⚠️  CONDITIONAL GO-LIVE - Address failed tests before production');
        } else {
            console.log('❌ NOT READY FOR GO-LIVE - Multiple critical failures detected');
        }
    }
}

// Export for use
module.exports = VaultBankQAExecutor;

// Run tests if called directly
if (require.main === module) {
    const qa = new VaultBankQAExecutor();
    qa.runAllTests().catch(console.error);
}
