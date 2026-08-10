import type {
  CustomerAddress,
  CustomerCreditAccount,
  CustomerProfile,
} from '@generated/prisma/client';
import type {
  CREDIT_ACCOUNT_STATUS,
  DOCUMENT_TYPE,
  TYPE_CUSTOMER,
} from '@generated/prisma/enums';

export interface CustomerCreditAccountResponse {
  id: string;
  creditLimit: number;
  balanceUsed: number;
  creditDays: number;
  status: CREDIT_ACCOUNT_STATUS;
  approvedAt: Date | null;
}

export interface CustomerProfileResponse {
  id: string;
  customerType: TYPE_CUSTOMER;
  documentType: DOCUMENT_TYPE;
  documentNumber: string;
  companyName: string | null;
  billingEmail: string | null;
  creditAccount?: CustomerCreditAccountResponse | null;
  createdAt: Date;
}

export interface CustomerAddressResponse {
  id: string;
  label: string;
  addressLine: string;
  city: string;
  province: string;
  countryCode: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: Date;
}

export function toCustomerProfileResponse(
  profile: CustomerProfile & { creditAccount?: CustomerCreditAccount | null },
): CustomerProfileResponse {
  return {
    id: profile.id,
    customerType: profile.customerType,
    documentType: profile.documentType,
    documentNumber: profile.documentNumber,
    companyName: profile.companyName,
    billingEmail: profile.billingEmail,
    creditAccount: profile.creditAccount
      ? toCustomerCreditAccountResponse(profile.creditAccount)
      : null,
    createdAt: profile.createdAt,
  };
}

export function toCustomerCreditAccountResponse(
  creditAccount: CustomerCreditAccount,
): CustomerCreditAccountResponse {
  return {
    id: creditAccount.id,
    creditLimit: Number(creditAccount.creditLimit),
    balanceUsed: Number(creditAccount.balanceUsed),
    creditDays: creditAccount.creditDays,
    status: creditAccount.status,
    approvedAt: creditAccount.approvedAt,
  };
}

export function toCustomerAddressResponse(
  address: CustomerAddress,
): CustomerAddressResponse {
  return {
    id: address.id,
    label: address.label,
    addressLine: address.addressesLine,
    city: address.city,
    province: address.province,
    countryCode: address.countryCode,
    postalCode: address.postalCode,
    latitude: address.latitude === null ? null : Number(address.latitude),
    longitude: address.longitude === null ? null : Number(address.longitude),
    isDefault: address.isDefault,
    createdAt: address.createdAt,
  };
}
