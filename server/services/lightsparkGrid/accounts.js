'use strict';

const crypto = require('crypto');
const { GridError } = require('./errors');
const store = require('./store');

const SHORT_TEXT = 255;

function str(value, max = SHORT_TEXT) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) {
    throw new GridError('GRID_INVALID_BENEFICIARY', `Field must be 1-${max} characters.`);
  }
  return text;
}

function optionalStr(value, max = SHORT_TEXT) {
  if (value === undefined || value === null || value === '') return undefined;
  return str(value, max);
}

function validateIndividualBeneficiary(input, { requireCountry = false } = {}) {
  if (!input || typeof input !== 'object') {
    throw new GridError('GRID_INVALID_BENEFICIARY', 'Beneficiary details are required.');
  }
  const beneficiary = {
    beneficiaryType: 'INDIVIDUAL',
    fullName: str(input.fullName || input.name, 250),
  };
  const country = optionalStr(input.countryOfResidence || input.country, 2);
  if (country) {
    if (!/^[A-Za-z]{2}$/.test(country)) {
      throw new GridError('GRID_INVALID_BENEFICIARY', 'countryOfResidence must be a two-letter country code.');
    }
    beneficiary.countryOfResidence = country.toUpperCase();
  } else if (requireCountry) {
    throw new GridError('GRID_INVALID_BENEFICIARY', 'countryOfResidence is required for this account type.');
  }
  const nationality = optionalStr(input.nationality, 2);
  if (nationality) {
    if (!/^[A-Za-z]{2}$/.test(nationality)) {
      throw new GridError('GRID_INVALID_BENEFICIARY', 'nationality must be a two-letter country code.');
    }
    beneficiary.nationality = nationality.toUpperCase();
  }
  const birthDate = optionalStr(input.birthDate, 10);
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw new GridError('GRID_INVALID_BENEFICIARY', 'birthDate must be YYYY-MM-DD.');
  }
  if (birthDate) beneficiary.birthDate = birthDate;
  return beneficiary;
}

/**
 * Build an accountInfo object using only fields defined by the Grid OpenAPI
 * specification for the supported account types. Unsupported types are
 * rejected rather than passed through blindly.
 */
function buildAccountInfo(input) {
  if (!input || typeof input !== 'object') {
    throw new GridError('GRID_INVALID_BENEFICIARY', 'accountInfo is required.');
  }
  const accountType = String(input.accountType || '').toUpperCase();
  const beneficiary = input.beneficiary;

  switch (accountType) {
    case 'USD_ACCOUNT': {
      const bankAccountType = String(input.bankAccountType || '').toUpperCase();
      if (!['CHECKING', 'SAVINGS'].includes(bankAccountType)) {
        throw new GridError('GRID_INVALID_BENEFICIARY', 'USD accounts require bankAccountType CHECKING or SAVINGS.');
      }
      const accountInfo = {
        accountType,
        accountNumber: str(input.accountNumber, 34),
        routingNumber: str(input.routingNumber, 9),
        bankAccountType,
        beneficiary: validateIndividualBeneficiary(beneficiary),
      };
      if (!/^\d{9}$/.test(accountInfo.routingNumber)) {
        throw new GridError('GRID_INVALID_BENEFICIARY', 'routingNumber must be nine digits.');
      }
      const bankName = optionalStr(input.bankName, 140);
      if (bankName) accountInfo.bankName = bankName;
      return accountInfo;
    }
    case 'EUR_ACCOUNT': {
      const iban = str(input.iban, 34).toUpperCase();
      if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
        throw new GridError('GRID_INVALID_BENEFICIARY', 'Invalid IBAN.');
      }
      const accountInfo = {
        accountType,
        iban,
        beneficiary: validateIndividualBeneficiary(beneficiary, { requireCountry: true }),
      };
      const swiftCode = optionalStr(input.swiftCode, 11);
      if (swiftCode) accountInfo.swiftCode = swiftCode.toUpperCase();
      return accountInfo;
    }
    case 'GBP_ACCOUNT': {
      const sortCode = str(input.sortCode, 6);
      const accountNumber = str(input.accountNumber, 8);
      if (!/^\d{6}$/.test(sortCode) || !/^\d{8}$/.test(accountNumber)) {
        throw new GridError('GRID_INVALID_BENEFICIARY', 'Invalid GBP sort code or account number.');
      }
      return {
        accountType,
        sortCode,
        accountNumber,
        beneficiary: validateIndividualBeneficiary(beneficiary),
      };
    }
    case 'INR_ACCOUNT': {
      const vpa = optionalStr(input.vpa, 255);
      const accountNumber = optionalStr(input.accountNumber, 18);
      const ifsc = optionalStr(input.ifsc, 11);
      if (!vpa && !(accountNumber && ifsc)) {
        throw new GridError('GRID_INVALID_BENEFICIARY', 'INR accounts require vpa or accountNumber plus ifsc.');
      }
      const accountInfo = { accountType, beneficiary: validateIndividualBeneficiary(beneficiary) };
      if (vpa) {
        if (!/^[a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+$/.test(vpa)) {
          throw new GridError('GRID_INVALID_BENEFICIARY', 'Invalid UPI VPA.');
        }
        accountInfo.vpa = vpa;
      } else {
        if (!/^\d{9,18}$/.test(accountNumber)) {
          throw new GridError('GRID_INVALID_BENEFICIARY', 'INR account number must be 9-18 digits.');
        }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) {
          throw new GridError('GRID_INVALID_BENEFICIARY', 'Invalid IFSC.');
        }
        accountInfo.accountNumber = accountNumber;
        accountInfo.ifsc = ifsc.toUpperCase();
      }
      return accountInfo;
    }
    case 'SWIFT_ACCOUNT': {
      const swiftCode = str(input.swiftCode, 11).toUpperCase();
      if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swiftCode)) {
        throw new GridError('GRID_INVALID_BENEFICIARY', 'Invalid SWIFT/BIC code.');
      }
      const country = str(input.country, 2).toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) {
        throw new GridError('GRID_INVALID_BENEFICIARY', 'country must be two letters.');
      }
      const accountNumber = optionalStr(input.accountNumber, 34);
      const iban = optionalStr(input.iban, 34);
      if (!accountNumber && !iban) {
        throw new GridError('GRID_INVALID_BENEFICIARY', 'SWIFT accounts require accountNumber or iban.');
      }
      const accountInfo = {
        accountType,
        swiftCode,
        bankName: str(input.bankName, 255),
        country,
        beneficiary: validateIndividualBeneficiary(beneficiary),
      };
      if (accountNumber) accountInfo.accountNumber = accountNumber;
      if (iban) accountInfo.iban = iban.toUpperCase();
      return accountInfo;
    }
    default:
      throw new GridError('GRID_ACCOUNT_TYPE_UNSUPPORTED', `VaultBank does not support ${accountType || 'this'} account type yet.`);
  }
}

function maskAccountInfo(accountInfo) {
  const tail = (value) => `****${String(value).slice(-4)}`;
  if (accountInfo.accountNumber) return tail(accountInfo.accountNumber);
  if (accountInfo.iban) return tail(accountInfo.iban);
  if (accountInfo.vpa) return tail(accountInfo.vpa);
  return '****';
}

function encryptDetails(config, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(':');
}

function destinationFingerprint(config, userId, accountInfo) {
  const canonical = [
    String(userId),
    accountInfo.accountType,
    accountInfo.beneficiary?.fullName?.toLowerCase() || '',
    accountInfo.accountNumber || accountInfo.iban || accountInfo.vpa || '',
    accountInfo.routingNumber || accountInfo.swiftCode || accountInfo.ifsc || '',
  ].join('|');
  return crypto.createHmac('sha256', config.encryptionKey).update(canonical).digest('hex');
}

function createAccountsService({ client, config, platform, data = store }) {
  async function listInternalAccounts(userId) {
    const mapping = await data.getCustomer(userId);
    if (!mapping) throw new GridError('GRID_CUSTOMER_NOT_FOUND', 'Complete Grid onboarding first.');
    const response = await client.request({
      path: '/customers/internal-accounts',
      query: { customerId: mapping.provider_customer_id },
      timeoutMs: 12000,
    });
    const accounts = (response?.data?.data || []);
    if (!Array.isArray(accounts)) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid internal accounts response was not an array.');
    }
    for (const account of accounts) {
      if (!account?.id) continue;
      await data.saveInternalAccount({
        providerAccountId: String(account.id),
        userId,
        currency: String(account.currency || '').toUpperCase(),
        status: account.status || null,
        type: account.type || null,
      });
    }
    return data.listInternalAccounts(userId);
  }

  async function getInternalAccount(userId, currency) {
    const code = String(currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new GridError('GRID_INVALID_CURRENCY', 'currency must be a three-letter code.');
    }
    const accounts = await listInternalAccounts(userId);
    const match = accounts.find((account) => account.currency === code && account.status === 'ACTIVE');
    if (!match) {
      throw new GridError('GRID_ACCOUNT_UNAVAILABLE', `No active Grid internal account for ${code}.`);
    }
    return match;
  }

  async function registerBeneficiary({ userId, currency, accountInfo: rawAccountInfo, platformAccountId }) {
    const code = String(currency || '').toUpperCase();
    const capabilities = await platform.getCapabilities();
    if (!capabilities.supportedCurrencies.some((entry) => entry.code === code)) {
      throw new GridError('GRID_CURRENCY_UNSUPPORTED', `${code} is not enabled for this Grid platform.`);
    }
    const mapping = await data.getCustomer(userId);
    if (!mapping) throw new GridError('GRID_CUSTOMER_NOT_FOUND', 'Complete Grid onboarding first.');
    const accountInfo = buildAccountInfo(rawAccountInfo);

    const body = {
      customerId: mapping.provider_customer_id,
      currency: code,
      accountInfo,
    };
    const accountRef = String(platformAccountId || '').trim();
    if (accountRef) body.platformAccountId = accountRef.slice(0, 255);

    const response = await client.request({
      method: 'POST',
      path: '/customers/external-accounts',
      body,
      idempotencyKey: `vb-grid-beneficiary-${userId}-${destinationFingerprint(config, userId, accountInfo)}`,
      timeoutMs: 20000,
    });
    const providerAccount = response?.data;
    if (!providerAccount || !providerAccount.id) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid external account response did not include an id.');
    }
    const row = await data.saveBeneficiary({
      userId,
      providerExternalAccountId: String(providerAccount.id),
      currency: code,
      accountType: accountInfo.accountType,
      beneficiaryName: accountInfo.beneficiary.fullName,
      detailsEncrypted: encryptDetails(config, accountInfo),
      destinationFingerprint: destinationFingerprint(config, userId, accountInfo),
      detailsMasked: maskAccountInfo(accountInfo),
      status: String(providerAccount.status || 'PENDING'),
    });
    return serializeBeneficiary(row);
  }

  async function listBeneficiaries(userId) {
    return data.listBeneficiaries(userId);
  }

  async function lookupBeneficiary(userId, beneficiaryId, sendingCurrency) {
    const beneficiary = await data.getBeneficiary(userId, beneficiaryId);
    if (!beneficiary) throw new GridError('GRID_BENEFICIARY_NOT_FOUND', 'Beneficiary not found.');
    const mapping = await data.getCustomer(userId);
    if (!mapping) throw new GridError('GRID_CUSTOMER_NOT_FOUND', 'Complete Grid onboarding first.');
    const code = String(sendingCurrency || '').toUpperCase();
    const query = { customerId: mapping.provider_customer_id };
    if (/^[A-Z]{3}$/.test(code)) query.sendingCurrency = code;
    const response = await client.request({
      path: `/receiver/external-account/${encodeURIComponent(beneficiary.provider_external_account_id)}`,
      query,
      timeoutMs: 15000,
    });
    const lookup = response?.data;
    if (!lookup || !lookup.accountId) {
      throw new GridError('GRID_UNEXPECTED_RESPONSE', 'Grid receiver lookup response was incomplete.');
    }
    return {
      accountId: String(lookup.accountId),
      lookupId: lookup.lookupId || null,
      sendingCurrency: lookup.sendingCurrency || null,
      supportedCurrencies: Array.isArray(lookup.supportedCurrencies) ? lookup.supportedCurrencies : [],
      requiredPayerDataFields: Array.isArray(lookup.requiredPayerDataFields) ? lookup.requiredPayerDataFields : [],
    };
  }

  return {
    listInternalAccounts,
    getInternalAccount,
    registerBeneficiary,
    listBeneficiaries,
    lookupBeneficiary,
    buildAccountInfo,
    encryptDetails,
  };
}

function serializeBeneficiary(row) {
  return {
    id: row.id,
    currency: row.currency,
    accountType: row.account_type,
    beneficiaryName: row.beneficiary_name,
    detailsMasked: row.details_masked,
    status: row.status,
    createdAt: row.created_at,
  };
}

module.exports = { createAccountsService, buildAccountInfo, validateIndividualBeneficiary };
