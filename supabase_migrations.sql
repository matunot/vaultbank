-- VaultBank Database Schema for Supabase
-- Run these migrations in your Supabase SQL Editor in order
-- Make sure to execute them in the dependency order shown below

-- ============================================================================
-- TABLE 1: Users
-- ============================================================================
-- Note: We use Supabase Auth, so this table stores additional user data
-- The 'id' field references auth.users.id

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    subscription TEXT CHECK (subscription IN ('free', 'gold', 'platinum')) DEFAULT 'free',
    role TEXT CHECK (role IN ('user', 'admin', 'super_admin')) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can only see and modify their own data
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- ============================================================================
-- TABLE 2: Accounts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT CHECK (type IN ('zero-balance', 'current', 'savings')) DEFAULT 'zero-balance',
    currency TEXT DEFAULT 'USD',
    balance NUMERIC(15,2) DEFAULT 0.00,
    overdraft_limit NUMERIC(10,2) DEFAULT 0.00,
    interest_rate NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- AUDIT LOGS TABLE (for tracking all user and system actions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL, -- Allow NULL for system actions
    action TEXT NOT NULL, -- Action type (e.g., 'LOGIN', 'TRANSFER_CREATED', etc.)
    entity_type TEXT NOT NULL, -- Entity affected (e.g., 'account', 'transaction', 'user')
    entity_id TEXT, -- ID of the affected entity
    details JSONB, -- Additional details in JSON format
    ip_address INET,
    user_agent TEXT,
    location JSONB, -- Geo location data if available
    session_id TEXT, -- Session tracking
    success BOOLEAN DEFAULT true, -- Whether the action was successful
    error_message TEXT, -- Error details if action failed
    metadata JSONB, -- Additional metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for audit logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own audit logs
CREATE POLICY "Users can view own audit logs" ON public.audit_logs
    FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all audit logs
CREATE POLICY "Admins can view all audit logs" ON public.audit_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- System can insert audit logs
CREATE POLICY "Allow audit log creation" ON public.audit_logs
    FOR INSERT WITH CHECK (true);

-- Indexes for audit logs performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON public.audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON public.audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_success ON public.audit_logs(success);

-- Enable RLS
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own accounts" ON public.accounts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own accounts" ON public.accounts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own accounts" ON public.accounts
    FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 3: Transactions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
    to_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
    method TEXT CHECK (method IN ('domestic', 'international', 'upi', 'paypal', 'card')) DEFAULT 'domestic',
    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    currency TEXT DEFAULT 'USD',
    fx_rate NUMERIC(10,6), -- For international transactions
    fees NUMERIC(10,2) DEFAULT 0.00,
    status TEXT CHECK (status IN ('pending', 'success', 'failed')) DEFAULT 'pending',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions" ON public.transactions
    FOR SELECT USING (
        auth.uid() IN (
            SELECT user_id FROM public.accounts WHERE id = transactions.from_account_id
            UNION
            SELECT user_id FROM public.accounts WHERE id = transactions.to_account_id
        )
    );

-- ============================================================================
-- TABLE 4: Cards
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    brand TEXT DEFAULT 'Visa',
    last_four TEXT,
    status TEXT CHECK (status IN ('active', 'frozen', 'cancelled')) DEFAULT 'active',
    spend_limit NUMERIC(10,2) DEFAULT 5000.00,
    online_allowed BOOLEAN DEFAULT true,
    card_number_hash TEXT, -- Store hashed version only
    expiry_month INTEGER CHECK (expiry_month BETWEEN 1 AND 12),
    expiry_year INTEGER CHECK (expiry_year >= 2025),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cards" ON public.cards
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cards" ON public.cards
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cards" ON public.cards
    FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 5: Rewards
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    points INTEGER DEFAULT 0 CHECK (points >= 0),
    cashback_amount NUMERIC(10,2) DEFAULT 0.00 CHECK (cashback_amount >= 0),
    tier TEXT CHECK (tier IN ('Silver', 'Gold', 'Platinum')) DEFAULT 'Silver',
    total_earned_points INTEGER DEFAULT 0 CHECK (total_earned_points >= 0),
    total_earned_cashback NUMERIC(10,2) DEFAULT 0.00 CHECK (total_earned_cashback >= 0),
    total_redeemed_points INTEGER DEFAULT 0 CHECK (total_redeemed_points >= 0),
    total_redeemed_cashback NUMERIC(10,2) DEFAULT 0.00 CHECK (total_redeemed_cashback >= 0),
    last_tier_upgrade TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rewards" ON public.rewards
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own rewards" ON public.rewards
    FOR UPDATE USING (auth.uid() = user_id);

-- Only one rewards record per user (upsert pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rewards_user_id ON public.rewards(user_id);

-- ============================================================================
-- TABLE 6: Alerts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT CHECK (type IN ('fraud', 'budget', 'goal', 'system', 'automation')) DEFAULT 'system',
    message TEXT NOT NULL,
    severity TEXT CHECK (severity IN ('info', 'warning', 'critical')) DEFAULT 'info',
    read BOOLEAN DEFAULT false,
    metadata JSONB, -- Store additional alert data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own alerts" ON public.alerts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own alerts" ON public.alerts
    FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================================
-- TABLE 7: Subscription History (Premium Feature)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    plan_type TEXT CHECK (plan_type IN ('free', 'yearly', 'lifetime')) NOT NULL,
    amount NUMERIC(10,2) DEFAULT 0.00,
    currency TEXT DEFAULT 'USD',
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_date TIMESTAMP WITH TIME ZONE, -- NULL for lifetime subscriptions
    status TEXT CHECK (status IN ('active', 'expired', 'cancelled')) DEFAULT 'active',
    payment_method TEXT, -- stripe, paypal, etc.
    payment_id TEXT, -- Reference to payment processor
    metadata JSONB, -- Additional payment/transaction details
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription history" ON public.subscription_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscription history" ON public.subscription_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Accounts indexes
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON public.accounts(type);

-- Transactions indexes
CREATE INDEX IF NOT EXISTS idx_transactions_from_account ON public.transactions(from_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_to_account ON public.transactions(to_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at);

-- Cards indexes
CREATE INDEX IF NOT EXISTS idx_cards_user_id ON public.cards(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_status ON public.cards(status);

-- Alerts indexes
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON public.alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_read ON public.alerts(read);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON public.alerts(created_at);

-- ============================================================================
-- FUNCTIONS AND TRIGGERS (Optional - for complex logic)
-- ============================================================================

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email)
    VALUES (NEW.id, NEW.email);

    -- Create default rewards record
    INSERT INTO public.rewards (user_id, points, tier)
    VALUES (NEW.id, 0, 'Silver');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create user profile on auth signup
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- RISK MONITORING AND AML TABLES
-- ============================================================================

-- TABLE 1: Risk Rules (for risk monitoring system)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.risk_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name TEXT NOT NULL UNIQUE,
    description TEXT,
    action TEXT CHECK (action IN ('login', 'transfer', 'subscription', 'mfa', 'security', 'all')) NOT NULL,
    condition JSONB NOT NULL, -- Flexible rule conditions
    risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 100) NOT NULL,
    severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')) NOT NULL,
    recommended_action TEXT CHECK (recommended_action IN ('allow', 'challenge', 'block')) NOT NULL,
    priority INTEGER DEFAULT 50 CHECK (priority >= 1 AND priority <= 100),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for risk rules
ALTER TABLE public.risk_rules ENABLE ROW LEVEL SECURITY;

-- Admins can manage risk rules
CREATE POLICY "Admins can manage risk rules" ON public.risk_rules
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Indexes for risk rules
CREATE INDEX IF NOT EXISTS idx_risk_rules_action ON public.risk_rules(action);
CREATE INDEX IF NOT EXISTS idx_risk_rules_active ON public.risk_rules(active);
CREATE INDEX IF NOT EXISTS idx_risk_rules_priority ON public.risk_rules(priority DESC);

-- TABLE 2: Risk Events (for risk evaluations and events)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'login', 'transfer', 'subscription', etc.
    details JSONB NOT NULL, -- Evaluation details, context data
    risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 100) NOT NULL,
    decision TEXT CHECK (decision IN ('allow', 'challenge', 'block')) NOT NULL,
    evaluated_rules JSONB, -- Array of triggered rules
    recommendations TEXT[], -- Action recommendations
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for risk events
ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;

-- Users can view their own risk events
CREATE POLICY "Users can view own risk events" ON public.risk_events
    FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all risk events
CREATE POLICY "Admins can view all risk events" ON public.risk_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Allow system to insert risk events
CREATE POLICY "Allow risk event creation" ON public.risk_events
    FOR INSERT WITH CHECK (true);

-- Indexes for risk events
CREATE INDEX IF NOT EXISTS idx_risk_events_user_id ON public.risk_events(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_events_event_type ON public.risk_events(event_type);
CREATE INDEX IF NOT EXISTS idx_risk_events_risk_score ON public.risk_events(risk_score);
CREATE INDEX IF NOT EXISTS idx_risk_events_decision ON public.risk_events(decision);
CREATE INDEX IF NOT EXISTS idx_risk_events_created_at ON public.risk_events(created_at DESC);

-- TABLE 3: AML Rules (for anti-money laundering monitoring)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aml_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name TEXT NOT NULL UNIQUE,
    description TEXT,
    category TEXT CHECK (category IN (
        'structuring_smurfing',
        'high_value_transfer',
        'cross_border_transfer',
        'rapid_movement',
        'round_tripping',
        'blacklist_check',
        'velocity_check',
        'geographic_risk',
        'transaction_amount',
        'beneficiary_check'
    )) NOT NULL,
    condition JSONB NOT NULL, -- Flexible rule conditions
    severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    action TEXT CHECK (action IN ('allow', 'review', 'block')) DEFAULT 'review',
    score_weight INTEGER CHECK (score_weight >= 0 AND score_weight <= 100) DEFAULT 50,
    jurisdiction TEXT CHECK (jurisdiction IN ('US', 'EU', 'Global')) DEFAULT 'Global',
    thresholds JSONB DEFAULT '{"usd": 10000, "transactions": 1, "timeWindowHours": 24}',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for AML rules
ALTER TABLE public.aml_rules ENABLE ROW LEVEL SECURITY;

-- Admins can manage AML rules
CREATE POLICY "Admins can manage AML rules" ON public.aml_rules
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Indexes for AML rules
CREATE INDEX IF NOT EXISTS idx_aml_rules_category ON public.aml_rules(category);
CREATE INDEX IF NOT EXISTS idx_aml_rules_active ON public.aml_rules(active);
CREATE INDEX IF NOT EXISTS idx_aml_rules_severity ON public.aml_rules(severity);
CREATE INDEX IF NOT EXISTS idx_aml_rules_score_weight ON public.aml_rules(score_weight DESC);

-- TABLE 4: AML Cases (for AML incidents and investigations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aml_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_number TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL, -- Can be null for non-transaction cases
    transaction_details JSONB NOT NULL,
    aml_score INTEGER CHECK (aml_score >= 0 AND aml_score <= 100) NOT NULL,
    risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')) NOT NULL,
    flags JSONB NOT NULL DEFAULT '[]', -- Array of triggered rule flags
    status TEXT CHECK (status IN ('open', 'review', 'approved', 'rejected', 'escalated', 'closed')) DEFAULT 'open',
    priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL, -- Admin assigned to case
    resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolution TEXT CHECK (resolution IN ('approved', 'rejected', 'false_positive', 'escalated', 'blocked')),
    resolution_notes TEXT,
    ip_address INET,
    user_agent TEXT,
    location JSONB, -- Country, region, city
    escalated BOOLEAN DEFAULT false,
    escalated_to TEXT CHECK (escalated_to IN ('compliance_officer', 'management', 'external_authority', 'blocked')),
    reported_to_authorities BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    due_date TIMESTAMP WITH TIME ZONE, -- SLA deadline
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS for AML cases
ALTER TABLE public.aml_cases ENABLE ROW LEVEL SECURITY;

-- Users can view their own AML cases (though this should be rare)
CREATE POLICY "Users can view own AML cases" ON public.aml_cases
    FOR SELECT USING (auth.uid() = user_id);

-- Admins can manage all AML cases
CREATE POLICY "Admins manage AML cases" ON public.aml_cases
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Indexes for AML cases
CREATE INDEX IF NOT EXISTS idx_aml_cases_user_id ON public.aml_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_aml_cases_status ON public.aml_cases(status);
CREATE INDEX IF NOT EXISTS idx_aml_cases_priority ON public.aml_cases(priority);
CREATE INDEX IF NOT EXISTS idx_aml_cases_risk_level ON public.aml_cases(risk_level);
CREATE INDEX IF NOT EXISTS idx_aml_cases_assigned_to ON public.aml_cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_aml_cases_created_at ON public.aml_cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_cases_due_date ON public.aml_cases(due_date);
CREATE INDEX IF NOT EXISTS idx_aml_cases_aml_score ON public.aml_cases(aml_score DESC);
CREATE INDEX IF NOT EXISTS idx_aml_cases_case_number ON public.aml_cases(case_number);

-- ============================================================================
-- FUNCTIONS FOR RISK AND AML FEATURES
-- ============================================================================

-- Function to create risk event
CREATE OR REPLACE FUNCTION public.create_risk_event(
    p_user_id UUID,
    p_event_type TEXT,
    p_details JSONB,
    p_risk_score INTEGER,
    p_decision TEXT,
    p_evaluated_rules JSONB DEFAULT NULL,
    p_recommendations TEXT[] DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    risk_event_id UUID;
BEGIN
    INSERT INTO public.risk_events (
        user_id, event_type, details, risk_score, decision, evaluated_rules, recommendations
    ) VALUES (
        p_user_id, p_event_type, p_details, p_risk_score, p_decision, p_evaluated_rules, p_recommendations
    ) RETURNING id INTO risk_event_id;

    RETURN risk_event_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create AML case with case number generation
CREATE OR REPLACE FUNCTION public.create_aml_case(
    p_user_id UUID,
    p_transaction_id UUID DEFAULT NULL,
    p_transaction_details JSONB DEFAULT '{}',
    p_aml_score INTEGER DEFAULT 0,
    p_risk_level TEXT DEFAULT 'low',
    p_flags JSONB DEFAULT '[]',
    p_status TEXT DEFAULT 'open',
    p_priority TEXT DEFAULT 'medium',
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_location JSONB DEFAULT NULL
)
RETURNS TABLE (id UUID, case_number TEXT) AS $$
DECLARE
    new_case_id UUID;
    new_case_number TEXT;
    due_date_calc TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Generate case number
    new_case_number := 'VB-AML-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                      LPAD(TO_CHAR(NEXTVAL('aml_case_seq'::regclass), 'FM000'), 3, '0');

    -- Calculate due date based on priority
    due_date_calc := CASE
        WHEN p_priority = 'critical' THEN NOW() + INTERVAL '1 day'
        WHEN p_priority = 'high' THEN NOW() + INTERVAL '3 days'
        WHEN p_priority = 'medium' THEN NOW() + INTERVAL '7 days'
        ELSE NOW() + INTERVAL '30 days'
    END;

    -- Insert the case
    INSERT INTO public.aml_cases (
        case_number, user_id, transaction_id, transaction_details,
        aml_score, risk_level, flags, status, priority,
        ip_address, user_agent, location, due_date
    ) VALUES (
        new_case_number, p_user_id, p_transaction_id, p_transaction_details,
        p_aml_score, p_risk_level, p_flags, p_status, p_priority,
        p_ip_address, p_user_agent, p_location, due_date_calc
    ) RETURNING aml_cases.id INTO new_case_id;

    RETURN QUERY SELECT new_case_id, new_case_number;
END;
$$ LANGUAGE plpgsql;

-- Sequence for case number generation
CREATE SEQUENCE IF NOT EXISTS aml_case_seq START 1;

-- TABLE 5: Automation Rules (for user automation features)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT CHECK (type IN ('auto_transfer', 'spending_alert', 'savings_goal', 'budget_limit')) NOT NULL,
    condition JSONB NOT NULL, -- Flexible rule conditions
    action JSONB NOT NULL, -- Flexible rule actions
    status TEXT CHECK (status IN ('active', 'paused')) DEFAULT 'active',
    last_triggered TIMESTAMP WITH TIME ZONE,
    trigger_count INTEGER DEFAULT 0 CHECK (trigger_count >= 0),
    success_count INTEGER DEFAULT 0 CHECK (success_count >= 0),
    last_error JSONB, -- Error details if last execution failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for automation rules
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own automation rules
CREATE POLICY "Users can manage own automation rules" ON public.automation_rules
    FOR ALL USING (auth.uid() = user_id);

-- Admins can view all automation rules for system management
CREATE POLICY "Admins can view all automation rules" ON public.automation_rules
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Indexes for automation rules
CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON public.automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_type ON public.automation_rules(type);
CREATE INDEX IF NOT EXISTS idx_automation_rules_status ON public.automation_rules(status);
CREATE INDEX IF NOT EXISTS idx_automation_rules_user_status ON public.automation_rules(user_id, status);
CREATE INDEX IF NOT EXISTS idx_automation_rules_last_triggered ON public.automation_rules(last_triggered DESC);

-- ============================================================================
-- REWARDS SYSTEM TABLES
-- ============================================================================

-- TABLE 6: Reward Rules (for flexible rewards configuration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rewards_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    reward_type TEXT CHECK (reward_type IN ('points', 'cashback', 'tier')) NOT NULL,
    condition JSONB NOT NULL, -- Flexible rule conditions (e.g., {"category": "dining", "amount": {"min": 0, "max": 500}})
    value NUMERIC(10,4) NOT NULL, -- Points multiplier or cashback percentage (e.g., 2.0 for 2x points, 0.05 for 5% cashback)
    priority INTEGER DEFAULT 50 CHECK (priority >= 1 AND priority <= 100),
    active BOOLEAN DEFAULT true,
    tier_eligibility TEXT[] DEFAULT ARRAY['Silver', 'Gold', 'Platinum'], -- Which tiers can earn this reward
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for reward rules
ALTER TABLE public.rewards_rules ENABLE ROW LEVEL SECURITY;

-- Admins can manage reward rules
CREATE POLICY "Admins can manage reward rules" ON public.rewards_rules
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Indexes for reward rules
CREATE INDEX IF NOT EXISTS idx_rewards_rules_active ON public.rewards_rules(active);
CREATE INDEX IF NOT EXISTS idx_rewards_rules_reward_type ON public.rewards_rules(reward_type);
CREATE INDEX IF NOT EXISTS idx_rewards_rules_priority ON public.rewards_rules(priority DESC);

-- TABLE 7: Reward Ledger (detailed transaction-level rewards)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rewards_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL, -- Nullable for manual awards
    rule_id UUID REFERENCES public.rewards_rules(id) ON DELETE SET NULL, -- Which rule applied this reward
    points INTEGER DEFAULT 0 CHECK (points >= 0),
    cashback_amount NUMERIC(10,2) DEFAULT 0.00 CHECK (cashback_amount >= 0),
    description TEXT NOT NULL,
    transaction_details JSONB, -- Store transaction context for reward calculation
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for reward ledger
ALTER TABLE public.rewards_ledger ENABLE ROW LEVEL SECURITY;

-- Users can view their own reward ledger entries
CREATE POLICY "Users can view own reward ledger" ON public.rewards_ledger
    FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all reward ledger entries
CREATE POLICY "Admins can view all reward ledger" ON public.rewards_ledger
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- System can insert reward ledger entries
CREATE POLICY "Allow reward ledger creation" ON public.rewards_ledger
    FOR INSERT WITH CHECK (true);

-- Indexes for reward ledger
CREATE INDEX IF NOT EXISTS idx_rewards_ledger_user_id ON public.rewards_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_rewards_ledger_transaction_id ON public.rewards_ledger(transaction_id);
CREATE INDEX IF NOT EXISTS idx_rewards_ledger_rule_id ON public.rewards_ledger(rule_id);
CREATE INDEX IF NOT EXISTS idx_rewards_ledger_created_at ON public.rewards_ledger(created_at DESC);

-- Function to update AML case status
CREATE OR REPLACE FUNCTION public.update_aml_case_status(
    p_case_id UUID,
    p_status TEXT,
    p_admin_id UUID,
    p_resolution TEXT DEFAULT NULL,
    p_resolution_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE public.aml_cases
    SET
        status = p_status,
        updated_at = NOW(),
        resolved_by = CASE WHEN p_status IN ('approved', 'rejected', 'closed') THEN p_admin_id ELSE resolved_by END,
        resolved_at = CASE WHEN p_status IN ('approved', 'rejected', 'closed') THEN NOW() ELSE resolved_at END,
        resolution = p_resolution,
        resolution_notes = p_resolution_notes
    WHERE id = p_case_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to update account balance
CREATE OR REPLACE FUNCTION public.update_account_balance(
    account_id UUID,
    amount_change NUMERIC
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE public.accounts
    SET balance = balance + amount_change
    WHERE id = account_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SEED DATA FOR RISK AND AML RULES
-- ============================================================================

-- Seed default risk rules
INSERT INTO public.risk_rules (rule_name, description, action, condition, risk_score, severity, recommended_action, priority) VALUES
('New Device Login', 'Login from a new device or IP address', 'login',
 '{"type": "device_check", "check": "isNewDevice", "threshold": true}',
 40, 'medium', 'challenge', 90),

('Large Transfer Amount', 'Transfer amount exceeds risk threshold', 'transfer',
 '{"type": "amount_check", "field": "amount", "operator": "gt", "threshold": 10000}',
 60, 'high', 'challenge', 85),

('Rapid Multiple Transfers', 'Multiple transfers within short time period', 'transfer',
 '{"type": "frequency_check", "action": "transfer", "timeframeMinutes": 10, "thresholdCount": 3}',
 50, 'high', 'block', 80),

('Disabled MFA', 'User disabled two-factor authentication', 'mfa',
 '{"type": "mfa_check", "check": "disabled", "recent": true}',
 25, 'low', 'allow', 70)
ON CONFLICT (rule_name) DO NOTHING;

-- Seed default AML rules
INSERT INTO public.aml_rules (rule_name, description, category, condition, severity, action, score_weight, priority) VALUES
('High Value Transfer Detection', 'Flags transfers exceeding $10,000 USD', 'high_value_transfer',
 '{"type": "amount_threshold", "threshold": 10000, "operator": "gte"}',
 'medium', 'review', 60),

('Structuring Detection', 'Multiple transfers just under $10,000 within 24 hours', 'structuring_smurfing',
 '{"type": "count_threshold", "threshold": 3, "timeWindow": 24, "bufferPercentage": 0.1}',
 'high', 'review', 70),

('Cross Border Risk', 'Transfers to high-risk jurisdictions', 'cross_border_transfer',
 '{"type": "high_risk_country", "operator": "in", "countries": ["KR", "VN", "PK", "NG"]}',
 'medium', 'review', 50),

('Rapid Transaction Velocity', 'More than 10 transactions within 1 hour', 'velocity_check',
 '{"type": "velocity_check", "maxTransactions": 10, "timeWindow": 1}',
 'high', 'block', 80)
ON CONFLICT (rule_name) DO NOTHING;

-- ============================================================================
-- SEED DATA FOR REWARDS RULES
-- ============================================================================

-- Seed default reward rules
INSERT INTO public.rewards_rules (name, description, reward_type, condition, value, priority, active, tier_eligibility) VALUES
('Dining Points Boost', 'Earn 2 points per $1 spent on dining', 'points',
 '{"category": "dining", "amount": {"min": 0}}',
 2.0, 90, true, ARRAY['Silver', 'Gold', 'Platinum']),

('Shopping Cashback', 'Get 5% cashback on shopping purchases', 'cashback',
 '{"category": "shopping", "amount": {"min": 0}}',
 0.05, 80, true, ARRAY['Silver', 'Gold', 'Platinum']),

('Gold Tier Bonus', 'Gold tier members get 10% bonus on all rewards', 'points',
 '{"minTier": "Gold"}',
 0.10, 70, true, ARRAY['Gold', 'Platinum']),

('Monthly Spending Milestone', 'Upgrade to Gold tier when spending reaches $2,000 in a month', 'tier',
 '{"monthlySpend": {"threshold": 2000, "currency": "USD"}}',
 1.0, 60, true, ARRAY['Silver'])
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- INVESTMENT & WEALTH MANAGEMENT TABLES
-- ============================================================================

-- TABLE 8: Investments (for tracking user investments and portfolio)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.investments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL, -- Stock ticker, fund name, crypto symbol (e.g., AAPL, VFIAX, BTC)
    asset_type TEXT CHECK (asset_type IN ('stock', 'bond', 'fund', 'crypto', 'real_estate', 'other')) NOT NULL,
    name TEXT NOT NULL, -- Human readable name (e.g., Apple Inc., Vanguard S&P 500 ETF)
    asset_class TEXT CHECK (asset_class IN ('equity', 'fixed_income', 'alternative', 'cash')) DEFAULT 'equity',
    quantity NUMERIC(20,8) NOT NULL CHECK (quantity > 0), -- Number of shares/units
    purchase_price NUMERIC(15,4) NOT NULL CHECK (purchase_price > 0), -- Price per unit at purchase
    current_price NUMERIC(15,4) CHECK (current_price >= 0), -- Current market price per unit
    amount_invested NUMERIC(15,2) NOT NULL CHECK (amount_invested > 0), -- Total amount invested
    current_value NUMERIC(15,2) GENERATED ALWAYS AS (
        quantity * COALESCE(current_price, purchase_price)
    ) STORED, -- Calculated current value
    gain_loss NUMERIC(15,2) GENERATED ALWAYS AS (
        current_value - amount_invested
    ) STORED, -- Calculated gain/loss
    gain_loss_percentage NUMERIC(10,4) GENERATED ALWAYS AS (
        CASE
            WHEN amount_invested > 0 THEN ((current_value - amount_invested) / amount_invested) * 100
            ELSE 0
        END
    ) STORED, -- Percentage gain/loss
    purchase_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    broker TEXT, -- Brokerage firm (e.g., Robinhood, Fidelity)
    metadata JSONB DEFAULT '{}', -- Additional asset-specific data
    tags TEXT[] DEFAULT ARRAY[]::TEXT[], -- User-defined tags
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for investments
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

-- Users can manage their own investments
CREATE POLICY "Users can manage own investments" ON public.investments
    FOR ALL USING (auth.uid() = user_id);

-- Indexes for investments
CREATE INDEX IF NOT EXISTS idx_investments_user_id ON public.investments(user_id);
CREATE INDEX IF NOT EXISTS idx_investments_symbol ON public.investments(symbol);
CREATE INDEX IF NOT EXISTS idx_investments_asset_type ON public.investments(asset_type);
CREATE INDEX IF NOT EXISTS idx_investments_asset_class ON public.investments(asset_class);
CREATE INDEX IF NOT EXISTS idx_investments_purchase_date ON public.investments(purchase_date DESC);

-- TABLE 9: Savings Goals (for user financial objectives)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.savings_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    goal_name TEXT NOT NULL,
    description TEXT,
    target_amount NUMERIC(15,2) NOT NULL CHECK (target_amount > 0),
    current_saved NUMERIC(15,2) DEFAULT 0.00 CHECK (current_saved >= 0),
    currency TEXT DEFAULT 'USD',
    deadline TIMESTAMP WITH TIME ZONE, -- Optional deadline
    category TEXT CHECK (category IN ('emergency_fund', 'vacation', 'house_down_payment', 'car_purchase', 'education', 'retirement', 'debt_payoff', 'business_startup', 'investment', 'other')) DEFAULT 'other',
    priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    status TEXT CHECK (status IN ('active', 'paused', 'completed', 'cancelled')) DEFAULT 'active',
    auto_contribute BOOLEAN DEFAULT false, -- Auto-contribute from transactions
    monthly_target NUMERIC(10,2) GENERATED ALWAYS AS (
        CASE
            WHEN deadline IS NOT NULL AND status = 'active' THEN
                GREATEST(0,
                    (target_amount - current_saved) /
                    GREATEST(1, EXTRACT(MONTH FROM age(deadline, NOW())))
                )
            ELSE
                CASE
                    WHEN target_amount > current_saved THEN
                        GREATEST(0, target_amount - current_saved)
                    ELSE 0
                END
        END
    ) STORED, -- Suggested monthly contribution
    completion_percentage NUMERIC(5,2) GENERATED ALWAYS AS (
        CASE
            WHEN target_amount > 0 THEN
                LEAST(100.00, (current_saved / target_amount) * 100)
            ELSE 0
        END
    ) STORED, -- Percentage of goal achieved
    progress_notes JSONB DEFAULT '[]', -- Notes about progress updates
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE -- Timestamp when goal was completed
);

-- Enable RLS for savings goals
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;

-- Users can manage their own savings goals
CREATE POLICY "Users can manage own savings goals" ON public.savings_goals
    FOR ALL USING (auth.uid() = user_id);

-- Indexes for savings goals
CREATE INDEX IF NOT EXISTS idx_savings_goals_user_id ON public.savings_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_savings_goals_status ON public.savings_goals(status);
CREATE INDEX IF NOT EXISTS idx_savings_goals_deadline ON public.savings_goals(deadline);
CREATE INDEX IF NOT EXISTS idx_savings_goals_category ON public.savings_goals(category);
CREATE INDEX IF NOT EXISTS idx_savings_goals_priority ON public.savings_goals(priority);

-- ============================================================================
-- FUNCTIONS FOR INVESTMENT AND WEALTH MANAGEMENT
-- ============================================================================

-- Function to update investment current value
CREATE OR REPLACE FUNCTION public.update_investment_price(
    p_investment_id UUID,
    p_new_price NUMERIC
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE public.investments
    SET
        current_price = p_new_price,
        last_updated = NOW()
    WHERE id = p_investment_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to add money to savings goal
CREATE OR REPLACE FUNCTION public.contribute_to_savings_goal(
    p_goal_id UUID,
    p_amount NUMERIC
)
RETURNS TABLE (
    goal_id UUID,
    new_current_saved NUMERIC,
    completion_percentage NUMERIC,
    is_completed BOOLEAN
) AS $$
DECLARE
    target_amt NUMERIC;
    new_saved NUMERIC;
    completion_pct NUMERIC;
    is_complete BOOLEAN;
BEGIN
    -- Get current values
    SELECT target_amount, current_saved INTO target_amt, new_saved
    FROM public.savings_goals
    WHERE id = p_goal_id;

    -- Calculate new saved amount
    new_saved := new_saved + p_amount;

    -- Update the goal
    UPDATE public.savings_goals
    SET
        current_saved = new_saved,
        updated_at = NOW(),
        status = CASE
            WHEN new_saved >= target_amt THEN 'completed'
            ELSE status
        END,
        completed_at = CASE
            WHEN new_saved >= target_amt AND completed_at IS NULL THEN NOW()
            ELSE completed_at
        END
    WHERE id = p_goal_id
    RETURNING id INTO goal_id;

    -- Calculate completion percentage
    completion_pct := CASE
        WHEN target_amt > 0 THEN LEAST(100.00, (new_saved / target_amt) * 100)
        ELSE 0
    END;

    is_complete := new_saved >= target_amt;

    RETURN QUERY SELECT p_goal_id, new_saved, completion_pct, is_complete;
END;
$$ LANGUAGE plpgsql;

-- Function to get portfolio summary for a user
CREATE OR REPLACE FUNCTION public.get_portfolio_summary(p_user_id UUID)
RETURNS TABLE (
    total_invested NUMERIC,
    total_current_value NUMERIC,
    total_gain_loss NUMERIC,
    total_gain_loss_percentage NUMERIC,
    stock_allocation NUMERIC,
    bond_allocation NUMERIC,
    fund_allocation NUMERIC,
    crypto_allocation NUMERIC,
    other_allocation JSONB
) AS $$
DECLARE
    total_inv NUMERIC := 0;
    total_value NUMERIC := 0;
    total_gain NUMERIC := 0;
    total_gain_pct NUMERIC := 0;
    stock_alloc NUMERIC := 0;
    bond_alloc NUMERIC := 0;
    fund_alloc NUMERIC := 0;
    crypto_alloc NUMERIC := 0;
    other_alloc JSONB := '{}';
BEGIN
    -- Calculate totals
    SELECT
        COALESCE(SUM(amount_invested), 0),
        COALESCE(SUM(current_value), 0),
        COALESCE(SUM(gain_loss), 0),
        CASE
            WHEN SUM(amount_invested) > 0 THEN
                (SUM(gain_loss) / SUM(amount_invested)) * 100
            ELSE 0
        END
    INTO total_inv, total_value, total_gain, total_gain_pct
    FROM public.investments
    WHERE user_id = p_user_id AND current_price IS NOT NULL;

    -- Calculate allocations by asset type
    SELECT
        COALESCE(SUM(CASE WHEN asset_type = 'stock' THEN current_value END), 0) /
        GREATEST(total_value, 1) * 100,
        COALESCE(SUM(CASE WHEN asset_type = 'bond' THEN current_value END), 0) /
        GREATEST(total_value, 1) * 100,
        COALESCE(SUM(CASE WHEN asset_type = 'fund' THEN current_value END), 0) /
        GREATEST(total_value, 1) * 100,
        COALESCE(SUM(CASE WHEN asset_type = 'crypto' THEN current_value END), 0) /
        GREATEST(total_value, 1) * 100
    INTO stock_alloc, bond_alloc, fund_alloc, crypto_alloc
    FROM public.investments
    WHERE user_id = p_user_id AND current_price IS NOT NULL;

    -- Calculate other asset types
    WITH other_assets AS (
        SELECT
            asset_type,
            SUM(current_value) as value,
            SUM(current_value) / GREATEST(total_value, 1) * 100 as percentage
        FROM public.investments
        WHERE user_id = p_user_id
            AND asset_type NOT IN ('stock', 'bond', 'fund', 'crypto')
            AND current_price IS NOT NULL
        GROUP BY asset_type
    )
    SELECT jsonb_object_agg(asset_type, jsonb_build_object(
        'value', ROUND(value, 2),
        'percentage', ROUND(percentage, 2)
    )) INTO other_alloc
    FROM other_assets;

    RETURN QUERY SELECT
        ROUND(total_inv, 2),
        ROUND(total_value, 2),
        ROUND(total_gain, 2),
        ROUND(total_gain_pct, 2),
        ROUND(stock_alloc, 2),
        ROUND(bond_alloc, 2),
        ROUND(fund_alloc, 2),
        ROUND(crypto_alloc, 2),
        other_alloc;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- REALTIME SUBSCRIPTIONS FOR LIVE UPDATES
-- ============================================================================

-- Create realtime publication for risk and AML tables
-- Note: This requires Supabase CLI or manual setup in dashboard
/*
DROP PUBLICATION IF EXISTS risk_aml_realtime;
CREATE PUBLICATION risk_aml_realtime FOR TABLE
    public.risk_events,
    public.aml_cases,
    public.risk_rules,
    public.aml_rules;
*/

-- ============================================================================
-- SEED DATA (Optional - for development)
-- ============================================================================

-- Insert sample data only if tables are empty (use with caution in production)
/*
-- Sample accounts for testing (run after user creation)
INSERT INTO public.accounts (user_id, type, balance, currency)
SELECT
    id as user_id,
    'current',
    1000.00,
    'USD'
FROM auth.users
WHERE id NOT IN (SELECT DISTINCT user_id FROM public.accounts)
LIMIT 1;

-- Sample alert for testing
INSERT INTO public.alerts (user_id, type, message, severity)
SELECT
    id as user_id,
    'system',
    'Welcome to VaultBank! Your account is ready to use.',
    'info'
FROM auth.users
WHERE id NOT IN (SELECT DISTINCT user_id FROM public.alerts)
LIMIT 1;
*/
