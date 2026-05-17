/**
 * Passport configuration for social authentication (Google & GitHub).
 *
 * The strategies use OAuth2 to obtain the user's email address. If a user with the
 * returned email does not exist in the demo store, a new user record is created on
 * the fly. The created user includes a `provider` field ("google" or "github") so
 * that the JWT payload can indicate the authentication source.
 */

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const { findUserByEmail, demoStore } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

// ---------------------------------------------------------------------------
// Serialize / deserialize – we keep the whole user object in the session for the
// demo (no persistent session store is used).
// ---------------------------------------------------------------------------
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    const user = demoStore.users.find(u => u.id === id);
    done(null, user || null);
});

// ---------------------------------------------------------------------------
// Google OAuth2 Strategy
// ---------------------------------------------------------------------------
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID || '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
            callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
            passReqToCallback: true
        },
        async (req, accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails && profile.emails[0] && profile.emails[0].value;
                if (!email) return done(new Error('No email returned from Google'), null);

                // Look for an existing user by email.
                let user = findUserByEmail(email);
                if (!user) {
                    // Create a new demo user.
                    user = {
                        id: uuidv4(),
                        email: email.toLowerCase(),
                        password: null, // No password for social login.
                        name: profile.displayName || email.split('@')[0],
                        role: 'user',
                        balance: 0,
                        subscription: 'free',
                        transactions: [],
                        summary: { totalIncome: 0, totalExpenses: 0, netSavings: 0 },
                        goals: [],
                        createdAt: new Date().toISOString(),
                        twoFAEnabled: false,
                        twoFASecret: null,
                        backupCodes: [],
                        provider: 'google'
                    };
                    demoStore.users.push(user);
                } else {
                    // Ensure provider is set for existing accounts.
                    user.provider = user.provider || 'google';
                }
                return done(null, user);
            } catch (err) {
                console.error('Google auth error:', err);
                return done(err, null);
            }
        }
    )
);

// ---------------------------------------------------------------------------
// GitHub OAuth2 Strategy
// ---------------------------------------------------------------------------
passport.use(
    new GitHubStrategy(
        {
            clientID: process.env.GITHUB_CLIENT_ID || '',
            clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
            callbackURL: process.env.GITHUB_CALLBACK_URL || '/api/auth/github/callback',
            scope: ['user:email']
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // GitHub may return multiple emails; prefer the primary verified one.
                const emailObj = (profile.emails || []).find(e => e.primary) || profile.emails?.[0];
                const email = emailObj && emailObj.value;
                if (!email) return done(new Error('No email returned from GitHub'), null);

                let user = findUserByEmail(email);
                if (!user) {
                    user = {
                        id: uuidv4(),
                        email: email.toLowerCase(),
                        password: null,
                        name: profile.displayName || profile.username || email.split('@')[0],
                        role: 'user',
                        balance: 0,
                        subscription: 'free',
                        transactions: [],
                        summary: { totalIncome: 0, totalExpenses: 0, netSavings: 0 },
                        goals: [],
                        createdAt: new Date().toISOString(),
                        twoFAEnabled: false,
                        twoFASecret: null,
                        backupCodes: [],
                        provider: 'github'
                    };
                    demoStore.users.push(user);
                } else {
                    user.provider = user.provider || 'github';
                }
                return done(null, user);
            } catch (err) {
                console.error('GitHub auth error:', err);
                return done(err, null);
            }
        }
    )
);

module.exports = passport;
